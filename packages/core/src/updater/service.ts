import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../db.js";
import {
  DEFAULT_UPDATE_CONFIG,
  type UpdateConfig,
  type UpdateStatus,
  type UpdateLogEntry,
  type UpdateMessage,
} from "@wtm/shared";
import * as gitlib from "./git.js";
import { REPO_ROOT } from "./git.js";

const execFileAsync = promisify(execFile);

/**
 * Servicio de autoactualizacion.
 *
 * Flujo de update:
 *   1. fetch del remoto.
 *   2. guardar el commit actual (para poder revertir).
 *   3. aplicar los commits nuevos.
 *   4. reconstruir (build). Si falla -> revertir al commit guardado,
 *      reconstruir de nuevo y alertar. El sistema nunca queda roto.
 *   5. si todo va bien -> pedir recarga de clientes y reiniciar el core.
 *
 * El reinicio lo hace salir(0): el supervisor (wtm-server.sh o el contenedor)
 * lo vuelve a levantar ya con el codigo nuevo compilado.
 */

const CONFIG_KEY = "update.config";
const TOKEN_KEY = "update.token"; // guardado aparte, nunca se devuelve
let lastChecked: string | null = null;
let lastMessage: UpdateMessage | null = null;
let busy = false;
let reloadBroadcaster: ((reason: string) => void) | null = null;

export function onReloadRequested(fn: (reason: string) => void) {
  reloadBroadcaster = fn;
}

function setMessage(level: UpdateMessage["level"], text: string) {
  lastMessage = { level, text, at: new Date().toISOString() };
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
    return {
      ...DEFAULT_UPDATE_CONFIG,
      ...stored,
      hasToken: !!token,
    };
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

  // El token se guarda/borra por separado.
  if (token !== undefined) setToken(token);

  // Si se configuro un repo, vincular git (init si hace falta) en segundo
  // plano. No bloquea el guardado ni rompe si git no esta disponible.
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
  };
}

export async function getHistory() {
  if (!(await gitlib.isGitRepo())) return [];
  return gitlib.history(50);
}

// ---- Reconstruir ----
async function rebuild(): Promise<{ ok: boolean; detail: string }> {
  try {
    await execFileAsync("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      maxBuffer: 50 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, detail: "build ok" };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return {
      ok: false,
      detail: (err.stderr || err.message || "build fallo").slice(-2000),
    };
  }
}

// ---- Revisar remoto ----
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
    setMessage(
      behind > 0 ? "info" : "success",
      behind > 0
        ? `Hay ${behind} actualizacion(es) disponible(s).`
        : "El sistema esta al dia.",
    );
  } catch (e) {
    setMessage("error", `Error al revisar: ${(e as Error).message}`);
  }
  return getStatus();
}

// ---- Aplicar actualizacion (con auto-reversion) ----
export async function update(): Promise<UpdateStatus> {
  if (busy) return getStatus();
  const config = getConfig();
  if (!(await gitlib.isGitRepo()) || !config.repo) {
    setMessage("error", "Actualizaciones no configuradas.");
    return getStatus();
  }

  busy = true;
  const prev = await gitlib.headHash();
  try {
    await gitlib.setRemote(config.repo, getToken());
    await gitlib.fetch(config.branch);
    const behind = await gitlib.behindCount(config.branch);
    if (behind === 0) {
      setMessage("success", "Ya estas en la ultima version.");
      busy = false;
      return getStatus();
    }

    await gitlib.applyRemote(config.branch);
    const applied = await gitlib.headHash();

    const build = await rebuild();
    if (!build.ok) {
      // Auto-reversion: el build fallo, volvemos al commit anterior.
      await gitlib.checkout(prev);
      await rebuild(); // reconstruir el estado bueno conocido
      log({
        action: "revert-failed-build",
        fromCommit: applied,
        toCommit: prev,
        ok: false,
        detail: build.detail,
      });
      setMessage(
        "error",
        "La actualizacion no compilo. Se revirtio al estado anterior.",
      );
      busy = false;
      return getStatus();
    }

    log({
      action: "update",
      fromCommit: prev,
      toCommit: applied,
      ok: true,
      detail: "actualizado y compilado",
    });
    setMessage("success", "Actualizado. Reiniciando el sistema...");
    busy = false;

    // Avisar a los clientes y reiniciar para cargar el codigo nuevo.
    scheduleReload("Sistema actualizado");
    return getStatus();
  } catch (e) {
    // Cualquier fallo inesperado: intentar volver al estado previo.
    try {
      await gitlib.checkout(prev);
      await rebuild();
    } catch {
      /* dejamos constancia abajo */
    }
    log({
      action: "update",
      fromCommit: prev,
      toCommit: null,
      ok: false,
      detail: (e as Error).message,
    });
    setMessage("error", `Fallo la actualizacion: ${(e as Error).message}`);
    busy = false;
    return getStatus();
  }
}

// ---- Reversion manual a un commit ----
export async function rollback(targetHash: string): Promise<UpdateStatus> {
  if (busy) return getStatus();
  if (!(await gitlib.isGitRepo())) {
    setMessage("error", "No es un repositorio git.");
    return getStatus();
  }
  if (!(await gitlib.commitExists(targetHash))) {
    setMessage("error", "El commit indicado no existe.");
    return getStatus();
  }

  busy = true;
  const prev = await gitlib.headHash();
  try {
    await gitlib.checkout(targetHash);
    const build = await rebuild();
    if (!build.ok) {
      await gitlib.checkout(prev);
      await rebuild();
      log({
        action: "rollback",
        fromCommit: prev,
        toCommit: targetHash,
        ok: false,
        detail: build.detail,
      });
      setMessage(
        "error",
        "Ese commit no compila. Se mantuvo el estado actual.",
      );
      busy = false;
      return getStatus();
    }
    log({
      action: "rollback",
      fromCommit: prev,
      toCommit: targetHash,
      ok: true,
      detail: "revertido y compilado",
    });
    setMessage("success", "Revertido. Reiniciando el sistema...");
    busy = false;
    scheduleReload("Sistema revertido");
    return getStatus();
  } catch (e) {
    setMessage("error", `Fallo la reversion: ${(e as Error).message}`);
    busy = false;
    return getStatus();
  }
}

// ---- Reinicio controlado ----
function scheduleReload(reason: string) {
  // Avisar a los clientes conectados para que se recarguen.
  reloadBroadcaster?.(reason);
  // Dar un momento para que el mensaje salga y luego salir; el supervisor
  // (wtm-server.sh / contenedor) reinicia el core con el codigo nuevo.
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
    if (status.behind > 0) {
      await update();
    }
  }, ms);
  console.log(
    `[updater] auto-update activo cada ${config.checkIntervalMin} min`,
  );
}

export function restartScheduler() {
  startScheduler();
}
