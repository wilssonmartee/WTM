import { spawn } from "node:child_process";
import { db } from "../db.js";
import {
  DEFAULT_UPDATE_CONFIG,
  type UpdateConfig,
  type UpdateStatus,
  type UpdateLogEntry,
  type UpdateMessage,
  type UpdatePhase,
  type UpdateProgressEvent,
} from "@wtm/shared";
import * as gitlib from "./git.js";
import { REPO_ROOT } from "./git.js";

/**
 * Servicio de autoactualizacion, EN TIEMPO REAL.
 *
 * update()/rollback() devuelven de inmediato y hacen el trabajo en segundo
 * plano, emitiendo eventos de progreso por WebSocket (fase + log en vivo).
 * Cuando el build termina bien, se pide recarga y el core se reinicia; el
 * supervisor lo levanta con el codigo nuevo y los clientes se reconectan y
 * refrescan solos.
 */

const CONFIG_KEY = "update.config";
const TOKEN_KEY = "update.token";
let lastChecked: string | null = null;
let lastMessage: UpdateMessage | null = null;
let busy = false;
let phase: UpdatePhase = "idle";

let reloadBroadcaster: ((reason: string) => void) | null = null;
let progressBroadcaster: ((ev: UpdateProgressEvent) => void) | null = null;

export function onReloadRequested(fn: (reason: string) => void) {
  reloadBroadcaster = fn;
}
export function onProgress(fn: (ev: UpdateProgressEvent) => void) {
  progressBroadcaster = fn;
}

function setMessage(level: UpdateMessage["level"], text: string) {
  lastMessage = { level, text, at: new Date().toISOString() };
}

/** Emite una linea de progreso (y mantiene lastMessage en sync). */
async function emit(
  p: UpdatePhase,
  line: string,
  level: UpdateProgressEvent["level"] = "info",
) {
  phase = p;
  setMessage(level, line);
  progressBroadcaster?.({
    type: "update-progress",
    phase: p,
    line,
    level,
    at: new Date().toISOString(),
    status: await getStatus(),
  });
}

// ---- Config ----
export function getConfig(): UpdateConfig {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(CONFIG_KEY) as { value: string } | undefined;
  const token = getToken();
  if (!row) return { ...DEFAULT_UPDATE_CONFIG, hasToken: !!token };
  try {
    const stored = JSON.parse(row.value) as Partial<UpdateConfig>;
    return { ...DEFAULT_UPDATE_CONFIG, ...stored, hasToken: !!token };
  } catch {
    return { ...DEFAULT_UPDATE_CONFIG, hasToken: !!token };
  }
}

export function setConfig(
  partial: Partial<UpdateConfig> & { token?: string | null },
): UpdateConfig {
  const current = getConfig();
  const { token, hasToken: _ignore, ...rest } = partial;
  const next: UpdateConfig = { ...current, ...rest, hasToken: current.hasToken };

  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(CONFIG_KEY, JSON.stringify({ ...next, hasToken: undefined }));

  if (token !== undefined) setToken(token);

  const cfg = getConfig();
  if (cfg.repo) {
    gitlib
      .initRepo(cfg.repo, cfg.branch, getToken())
      .catch((e) =>
        setMessage("error", `No se pudo vincular git: ${e.message}`),
      );
  }
  return cfg;
}

function getToken(): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(TOKEN_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function setToken(token: string | null) {
  if (token) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(TOKEN_KEY, token);
  } else {
    db.prepare("DELETE FROM settings WHERE key = ?").run(TOKEN_KEY);
  }
}

// ---- Log de auditoria ----
function log(entry: Omit<UpdateLogEntry, "at">) {
  db.prepare(
    `INSERT INTO update_log (at, action, from_commit, to_commit, ok, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    entry.action,
    entry.fromCommit,
    entry.toCommit,
    entry.ok ? 1 : 0,
    entry.detail,
  );
}

export function getLog(limit = 50): UpdateLogEntry[] {
  const rows = db
    .prepare(
      `SELECT at, action, from_commit AS fromCommit, to_commit AS toCommit, ok, detail
       FROM update_log ORDER BY at DESC LIMIT ?`,
    )
    .all(limit) as (Omit<UpdateLogEntry, "ok"> & { ok: number })[];
  return rows.map((r) => ({ ...r, ok: !!r.ok }));
}

// ---- Status ----
export async function getStatus(): Promise<UpdateStatus> {
  const isRepo = await gitlib.isGitRepo();
  const config = getConfig();
  const currentCommit = isRepo ? await gitlib.currentCommit() : null;
  let behind = 0;
  if (isRepo && config.repo && config.branch) {
    behind = await gitlib.behindCount(config.branch).catch(() => 0);
  }
  return {
    isGitRepo: isRepo,
    config,
    currentCommit,
    behind,
    lastChecked,
    lastMessage,
    busy,
    phase,
  };
}

export async function getHistory() {
  if (!(await gitlib.isGitRepo())) return [];
  return gitlib.history(50);
}

// ---- Reconstruir con salida en vivo ----
/**
 * Instala las dependencias (npm install). Necesario cuando una actualizacion
 * trae paquetes nuevos en package.json: sin esto, el build falla con "Cannot
 * find module". Es idempotente y rapido si ya esta todo instalado.
 */
function npmInstall(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let tail = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      tail = (tail + text).slice(-3000);
      for (const raw of text.split("\n")) {
        const l = raw.trim();
        if (l && /(added|removed|packages|npm warn|npm error|changed)/i.test(l)) {
          emit("building", l.slice(0, 160), /error/i.test(l) ? "error" : "info");
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) =>
      resolve(
        code === 0
          ? { ok: true, detail: "deps ok" }
          : { ok: false, detail: tail.slice(-2000) || "npm install fallo" },
      ),
    );
    child.on("error", (e) => resolve({ ok: false, detail: e.message }));
  });
}

function rebuild(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let tail = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      tail = (tail + text).slice(-4000);
      // Emitimos lineas significativas del build como progreso.
      for (const raw of text.split("\n")) {
        const l = raw.trim();
        if (
          l &&
          /(building|transform|tsc|vite|compil|error|built|bundle|esbuild)/i.test(
            l,
          )
        ) {
          emit("building", l.slice(0, 160), /error/i.test(l) ? "error" : "info");
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      resolve(
        code === 0
          ? { ok: true, detail: "build ok" }
          : { ok: false, detail: tail.slice(-2000) || "build fallo" },
      );
    });
    child.on("error", (e) => resolve({ ok: false, detail: e.message }));
  });
}

// ---- Revisar remoto (sincrono, rapido) ----
export async function check(): Promise<UpdateStatus> {
  const config = getConfig();
  if (!(await gitlib.isGitRepo())) {
    setMessage("error", "La carpeta no es un repositorio git.");
    return getStatus();
  }
  if (!config.repo) {
    setMessage("error", "Configura un repositorio primero.");
    return getStatus();
  }
  try {
    await emit("checking", "Revisando el remoto...");
    await gitlib.setRemote(config.repo, getToken());
    await gitlib.fetch(config.branch);
    lastChecked = new Date().toISOString();
    const behind = await gitlib.behindCount(config.branch);
    log({
      action: "check",
      fromCommit: null,
      toCommit: null,
      ok: true,
      detail: `${behind} commit(s) nuevos`,
    });
    phase = "idle";
    await emit(
      "idle",
      behind > 0
        ? `Hay ${behind} actualizacion(es) disponible(s).`
        : "El sistema esta al dia.",
      "success",
    );
  } catch (e) {
    await emit("error", `Error al revisar: ${(e as Error).message}`, "error");
  }
  return getStatus();
}

// ---- Aplicar actualizacion (asincrono, con progreso) ----
export function update(): UpdateStatus | Promise<UpdateStatus> {
  if (busy) return getStatus();
  busy = true;
  // Lanzar el trabajo en segundo plano; devolver el estado actual ya.
  void runUpdate();
  return getStatus();
}

async function runUpdate() {
  const config = getConfig();
  if (!(await gitlib.isGitRepo()) || !config.repo) {
    await emit("error", "Actualizaciones no configuradas.", "error");
    busy = false;
    phase = "idle";
    return;
  }
  const prev = await gitlib.headHash();
  try {
    await emit("checking", "Revisando el remoto...");
    await gitlib.setRemote(config.repo, getToken());
    await gitlib.fetch(config.branch);
    const behind = await gitlib.behindCount(config.branch);
    if (behind === 0) {
      await emit("done", "Ya estas en la ultima version.", "success");
      busy = false;
      phase = "idle";
      return;
    }

    await emit("downloading", `Aplicando ${behind} commit(s)...`);
    await gitlib.applyRemote(config.branch);
    const applied = await gitlib.headHash();

    await emit("building", "Instalando dependencias...");
    const deps = await npmInstall();
    if (!deps.ok) {
      await emit(
        "reverting",
        "Fallo instalar dependencias. Revirtiendo...",
        "error",
      );
      await gitlib.checkout(prev);
      await npmInstall();
      await rebuild();
      log({
        action: "revert-failed-build",
        fromCommit: applied,
        toCommit: prev,
        ok: false,
        detail: deps.detail,
      });
      busy = false;
      phase = "error";
      await emit(
        "error",
        "No se pudieron instalar las dependencias. Se restauro la version anterior.",
        "error",
      );
      phase = "idle";
      return;
    }

    await emit("building", "Compilando la nueva version...");
    const build = await rebuild();
    if (!build.ok) {
      await emit(
        "reverting",
        "El build fallo. Revirtiendo al estado anterior...",
        "error",
      );
      await gitlib.checkout(prev);
      await rebuild();
      log({
        action: "revert-failed-build",
        fromCommit: applied,
        toCommit: prev,
        ok: false,
        detail: build.detail,
      });
      busy = false;
      phase = "error";
      await emit(
        "error",
        "La actualizacion no compilo. Se restauro la version anterior.",
        "error",
      );
      phase = "idle";
      return;
    }

    log({
      action: "update",
      fromCommit: prev,
      toCommit: applied,
      ok: true,
      detail: "actualizado y compilado",
    });
    await emit("restarting", "Actualizado. Reiniciando el sistema...", "success");
    busy = false;
    scheduleReload("Sistema actualizado");
  } catch (e) {
    try {
      await emit("reverting", "Error. Restaurando version anterior...", "error");
      await gitlib.checkout(prev);
      await npmInstall();
      await rebuild();
    } catch {
      /* se registra abajo */
    }
    log({
      action: "update",
      fromCommit: prev,
      toCommit: null,
      ok: false,
      detail: (e as Error).message,
    });
    busy = false;
    await emit("error", `Fallo la actualizacion: ${(e as Error).message}`, "error");
    phase = "idle";
  }
}

// ---- Reversion manual (asincrono, con progreso) ----
export function rollback(targetHash: string): UpdateStatus | Promise<UpdateStatus> {
  if (busy) return getStatus();
  busy = true;
  void runRollback(targetHash);
  return getStatus();
}

async function runRollback(targetHash: string) {
  if (!(await gitlib.isGitRepo())) {
    await emit("error", "No es un repositorio git.", "error");
    busy = false;
    phase = "idle";
    return;
  }
  if (!(await gitlib.commitExists(targetHash))) {
    await emit("error", "El commit indicado no existe.", "error");
    busy = false;
    phase = "idle";
    return;
  }
  const prev = await gitlib.headHash();
  try {
    await emit("downloading", `Cambiando a ${targetHash.slice(0, 7)}...`);
    await gitlib.checkout(targetHash);
    await emit("building", "Instalando dependencias...");
    await npmInstall();
    await emit("building", "Compilando...");
    const build = await rebuild();
    if (!build.ok) {
      await emit("reverting", "Ese commit no compila. Restaurando...", "error");
      await gitlib.checkout(prev);
      await rebuild();
      log({
        action: "rollback",
        fromCommit: prev,
        toCommit: targetHash,
        ok: false,
        detail: build.detail,
      });
      busy = false;
      await emit("error", "No se pudo revertir: ese commit no compila.", "error");
      phase = "idle";
      return;
    }
    log({
      action: "rollback",
      fromCommit: prev,
      toCommit: targetHash,
      ok: true,
      detail: "revertido y compilado",
    });
    await emit("restarting", "Revertido. Reiniciando el sistema...", "success");
    busy = false;
    scheduleReload("Sistema revertido");
  } catch (e) {
    busy = false;
    await emit("error", `Fallo la reversion: ${(e as Error).message}`, "error");
    phase = "idle";
  }
}

// ---- Reinicio controlado ----
function scheduleReload(reason: string) {
  reloadBroadcaster?.(reason);
  setTimeout(() => {
    console.log(`[updater] ${reason}: reiniciando para aplicar cambios...`);
    process.exit(0);
  }, 1500);
}

// ---- Programador de auto-update ----
let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (timer) clearInterval(timer);
  const config = getConfig();
  if (!config.autoUpdate) return;
  const ms = Math.max(1, config.checkIntervalMin) * 60 * 1000;
  timer = setInterval(async () => {
    const cfg = getConfig();
    if (!cfg.autoUpdate || busy) return;
    const status = await check();
    if (status.behind > 0) update();
  }, ms);
  console.log(`[updater] auto-update activo cada ${config.checkIntervalMin} min`);
}

export function restartScheduler() {
  startScheduler();
}
