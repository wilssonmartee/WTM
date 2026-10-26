import type { TerminalLine, TerminalResult, User } from "@wtm/shared";
import { db } from "./db.js";
import {
  catalog,
  install,
  uninstall,
  isInstalled,
} from "./modules/registry.js";
import { config } from "./config.js";
import { WTM_VERSION } from "@wtm/shared";
import * as updater from "./updater/service.js";
import * as git from "./updater/git.js";
import * as sysops from "./sysops.js";

/**
 * Interprete de la terminal del sistema WTM.
 *
 * Shell acotada a WTM con comandos de nombre familiar (estilo Linux). El
 * "sistema de archivos" es virtual y refleja la estructura logica de WTM:
 *   /empresas   /modulos   /sistema
 *
 * Ademas de navegar, administra el sistema: estado, logs, paquetes, base de
 * datos, git y operaciones de mantenimiento (recompilar, reiniciar, actualizar)
 * para superadmin.
 *
 * Los comandos que tardan o emiten salida en vivo usan 'emit' (streaming por
 * WebSocket); el resto devuelven lineas de una vez.
 */

interface Session {
  cwd: string;
}

/** Emisor de salida en vivo hacia el cliente (una linea a la vez). */
export type Emit = (line: TerminalLine) => void;

const VFS_ROOT = ["empresas", "modulos", "sistema"];

function line(kind: TerminalLine["kind"], text: string): TerminalLine {
  return { kind, text };
}

function listCompanies(): string[] {
  const rows = db.prepare("SELECT slug FROM companies ORDER BY slug").all() as {
    slug: string;
  }[];
  return rows.map((r) => r.slug);
}

/**
 * Ejecuta un comando. Devuelve lineas sincronas en el resultado; los comandos
 * de larga duracion usan 'emit' para enviar salida en vivo y devuelven solo el
 * cwd. 'emit' puede ser null si el caller no soporta streaming.
 */
export async function runCommand(
  user: User,
  session: Session,
  raw: string,
  emit: Emit | null = null,
): Promise<TerminalResult> {
  const input = raw.trim();
  const lines: TerminalLine[] = [];
  if (!input) return { cwd: session.cwd, lines };

  const [cmd, ...args] = input.split(/\s+/);

  switch (cmd) {
    case "help":
      lines.push(...helpLines(user));
      break;

    case "pwd":
      lines.push(line("stdout", session.cwd));
      break;

    case "whoami":
      lines.push(line("stdout", `${user.username} (${user.globalRole})`));
      break;

    case "date":
      lines.push(line("stdout", new Date().toString()));
      break;

    case "uptime": {
      const s = sysops.hostStats();
      lines.push(
        line("stdout", `activo ${fmtDuration(s.uptimeSec)} · carga ${s.loadAvg}`),
      );
      break;
    }

    case "clear":
    case "cls":
      return { cwd: session.cwd, lines: [{ kind: "info", text: "\f" }] };

    case "echo":
      lines.push(line("stdout", args.join(" ")));
      break;

    case "ls":
    case "dir":
      lines.push(...lsCommand(session, args[0]));
      break;

    case "cd":
      lines.push(...cdCommand(session, args[0]));
      break;

    case "cat":
      lines.push(...catCommand(session, args[0]));
      break;

    case "wtm":
      return {
        cwd: session.cwd,
        lines: await wtmCommand(user, args, emit),
      };

    default:
      lines.push(
        line("stderr", `comando no encontrado: ${cmd}. Escribe 'help'.`),
      );
  }

  return { cwd: session.cwd, lines };
}

function helpLines(user: User): TerminalLine[] {
  const base = [
    line("info", "NAVEGACION Y BASICOS"),
    line("stdout", "  help                    Esta ayuda"),
    line("stdout", "  pwd                     Directorio actual"),
    line("stdout", "  ls [ruta]               Listar contenido"),
    line("stdout", "  cd <ruta>               Cambiar de directorio"),
    line("stdout", "  cat <archivo>           Ver un archivo virtual"),
    line("stdout", "  clear                   Limpiar pantalla"),
    line("stdout", "  whoami / date / uptime  Info rapida"),
    line("info", "SISTEMA"),
    line("stdout", "  wtm status              Estado del core y del host"),
    line("stdout", "  wtm version             Version de WTM"),
    line("stdout", "  wtm logs [n]            Ultimas n lineas del log de updates"),
    line("info", "PAQUETES (MODULOS)"),
    line("stdout", "  wtm pkg list            Listar modulos"),
    line("stdout", "  wtm pkg info <id>       Detalle de un modulo"),
    line("info", "BASE DE DATOS"),
    line("stdout", "  wtm db tables           Listar tablas"),
    line("stdout", "  wtm db count <tabla>    Contar filas"),
    line("stdout", "  wtm db schema <tabla>   Ver columnas de una tabla"),
    line("info", "GIT / VERSIONES"),
    line("stdout", "  wtm git status          Commit actual y pendientes"),
    line("stdout", "  wtm git log [n]         Historial de commits"),
  ];
  if (user.globalRole === "superadmin") {
    base.push(
      line("info", "MANTENIMIENTO (superadmin)"),
      line("stdout", "  wtm pkg install <id>    Instalar modulo"),
      line("stdout", "  wtm pkg remove <id>     Desinstalar modulo"),
      line("stdout", "  wtm rebuild             Recompilar el sistema"),
      line("stdout", "  wtm restart [--build]   Reiniciar el core (opcionalmente recompila)"),
      line("stdout", "  wtm update check        Buscar actualizaciones en GitHub"),
      line("stdout", "  wtm update apply        Aplicar la ultima version"),
    );
  }
  return base;
}

function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function normalizePath(cwd: string, target?: string): string {
  if (!target) return cwd;
  let base: string[];
  if (target.startsWith("/")) {
    base = [];
  } else {
    base = cwd === "/" ? [] : cwd.slice(1).split("/");
  }
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return "/" + base.join("/");
}

function pathExists(p: string): boolean {
  if (p === "/") return true;
  const parts = p.slice(1).split("/").filter(Boolean);
  if (parts.length === 0) return true;
  if (!VFS_ROOT.includes(parts[0])) return false;
  if (parts.length === 1) return true;
  if (parts[0] === "empresas") {
    return listCompanies().includes(parts[1]) && parts.length === 2;
  }
  if (parts[0] === "modulos") {
    return catalog().some((m) => m.id === parts[1]) && parts.length === 2;
  }
  if (parts[0] === "sistema") {
    return ["info.txt", "logs"].includes(parts[1]) && parts.length === 2;
  }
  return false;
}

function lsCommand(session: Session, target?: string): TerminalLine[] {
  const p = normalizePath(session.cwd, target);
  if (!pathExists(p)) {
    return [line("stderr", `ls: no existe la ruta '${p}'`)];
  }
  const parts = p.slice(1).split("/").filter(Boolean);

  if (parts.length === 0) {
    return VFS_ROOT.map((d) => line("stdout", d + "/"));
  }
  if (parts[0] === "empresas" && parts.length === 1) {
    return listCompanies().map((c) => line("stdout", c + "/"));
  }
  if (parts[0] === "modulos" && parts.length === 1) {
    return catalog().map((m) =>
      line("stdout", `${m.id}  (${m.installed ? "instalado" : m.status})`),
    );
  }
  if (parts[0] === "sistema" && parts.length === 1) {
    return [line("stdout", "info.txt"), line("stdout", "logs/")];
  }
  return [line("info", "(vacio)")];
}

function cdCommand(session: Session, target?: string): TerminalLine[] {
  if (!target) {
    session.cwd = "/";
    return [];
  }
  const p = normalizePath(session.cwd, target);
  if (!pathExists(p)) {
    return [line("stderr", `cd: no existe la ruta '${p}'`)];
  }
  session.cwd = p;
  return [];
}

function catCommand(session: Session, target?: string): TerminalLine[] {
  if (!target) return [line("stderr", "cat: indica un archivo")];
  const p = normalizePath(session.cwd, target);
  if (p === "/sistema/info.txt") {
    const s = sysops.hostStats();
    return [
      line("stdout", `WTM ${WTM_VERSION}`),
      line("stdout", `host:      ${s.platform}`),
      line("stdout", `node:      ${s.node}`),
      line("stdout", `cpus:      ${s.cpus}`),
      line("stdout", `memoria:   ${s.freeMemMb}/${s.totalMemMb} MB libres`),
    ];
  }
  return [line("stderr", `cat: no se puede leer '${p}'`)];
}

async function wtmCommand(
  user: User,
  args: string[],
  emit: Emit | null,
): Promise<TerminalLine[]> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "version":
      return [line("stdout", `WTM ${WTM_VERSION}`)];
    case "status":
      return statusLines();
    case "logs":
      return logsLines(rest[0]);
    case "pkg":
      return pkgCommand(user, rest);
    case "db":
      return dbCommand(rest);
    case "git":
      return gitCommand(rest);
    case "rebuild":
      return rebuildCommand(user, emit);
    case "restart":
      return restartCommand(user, rest, emit);
    case "update":
      return updateCommand(user, rest, emit);
    default:
      return [
        line(
          "stderr",
          `wtm: subcomando desconocido '${sub ?? ""}'. Prueba: status, version, logs, pkg, db, git, rebuild, restart, update`,
        ),
      ];
  }
}

function statusLines(): TerminalLine[] {
  const s = sysops.hostStats();
  const installed = catalog().filter((m) => m.installed).length;
  return [
    line("info", "Estado del core WTM"),
    line("stdout", `  version:    ${WTM_VERSION}`),
    line("stdout", `  puerto:     ${config.port}`),
    line("stdout", `  base datos: SQLite (${config.dbFile})`),
    line("stdout", `  modulos:    ${installed} instalados / ${catalog().length} en catalogo`),
    line("stdout", `  activo:     ${fmtDuration(s.uptimeSec)}`),
    line("stdout", `  memoria:    ${s.rssMb} MB (proceso) · ${s.freeMemMb}/${s.totalMemMb} MB host`),
    line("stdout", `  host:       ${s.platform} · node ${s.node} · ${s.cpus} CPU · carga ${s.loadAvg}`),
    line("stdout", `  estado:     ${sysops.sysBusy() ? "ocupado (mantenimiento)" : "en linea"}`),
  ];
}

function logsLines(nArg?: string): TerminalLine[] {
  const n = Math.max(1, Math.min(200, Number(nArg) || 20));
  const log = updater.getLog(n);
  if (log.length === 0) return [line("info", "(sin registros de actualizacion)")];
  return log.map((e) =>
    line(
      e.ok ? "stdout" : "stderr",
      `[${e.at.slice(0, 19).replace("T", " ")}] ${e.action}: ${e.detail}`,
    ),
  );
}

function pkgCommand(user: User, args: string[]): TerminalLine[] {
  const [action, target] = args;

  if (action === "list" || !action) {
    return [
      line("info", "Modulos:"),
      ...catalog().map((m) => {
        const state = m.installed
          ? "instalado"
          : m.status === "coming-soon"
            ? "no disponible"
            : "disponible";
        return line("stdout", `  ${m.id.padEnd(14)} ${m.version}  ${state}`);
      }),
    ];
  }

  if (action === "info") {
    if (!target) return [line("stderr", "wtm pkg info: indica un modulo")];
    const m = catalog().find((x) => x.id === target);
    if (!m) return [line("stderr", `wtm pkg: modulo desconocido '${target}'`)];
    return [
      line("info", `Modulo ${m.id}`),
      line("stdout", `  nombre:      ${m.name}`),
      line("stdout", `  version:     ${m.version}`),
      line("stdout", `  categoria:   ${m.category}`),
      line("stdout", `  alcance:     ${m.dataScope}`),
      line("stdout", `  instalado:   ${m.installed ? "si" : "no"}`),
      line("stdout", `  descripcion: ${m.description}`),
    ];
  }

  if (action === "install" || action === "remove") {
    if (user.globalRole !== "superadmin") {
      return [line("stderr", "wtm pkg: requiere superadmin")];
    }
    if (!target) {
      return [line("stderr", `wtm pkg ${action}: indica un modulo`)];
    }
    if (action === "install") {
      if (isInstalled(target)) {
        return [line("info", `'${target}' ya esta instalado.`)];
      }
      install(target).catch(() => {});
      return [line("info", `Instalando '${target}'... (ver 'wtm pkg list')`)];
    }
    uninstall(target, false).catch(() => {});
    return [line("info", `Desinstalando '${target}'...`)];
  }

  return [line("stderr", `wtm pkg: accion desconocida '${action}'`)];
}

function dbCommand(args: string[]): TerminalLine[] {
  const [action, arg] = args;
  if (action === "tables") {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    return rows.map((r) => line("stdout", r.name));
  }
  if (action === "count" && arg) {
    if (!tableExists(arg)) return [line("stderr", `db: no existe la tabla '${arg}'`)];
    const r = db.prepare(`SELECT COUNT(*) AS n FROM "${arg}"`).get() as {
      n: number;
    };
    return [line("stdout", `${arg}: ${r.n} filas`)];
  }
  if (action === "schema" && arg) {
    if (!tableExists(arg)) return [line("stderr", `db: no existe la tabla '${arg}'`)];
    const cols = db.prepare(`PRAGMA table_info("${arg}")`).all() as {
      name: string;
      type: string;
      pk: number;
      notnull: number;
    }[];
    return [
      line("info", `Columnas de ${arg}:`),
      ...cols.map((c) =>
        line(
          "stdout",
          `  ${c.name.padEnd(18)} ${c.type || "?"}${c.pk ? " PK" : ""}${c.notnull ? " NOT NULL" : ""}`,
        ),
      ),
    ];
  }
  return [line("stderr", "wtm db: usa 'tables', 'count <tabla>' o 'schema <tabla>'")];
}

function tableExists(name: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

async function gitCommand(args: string[]): Promise<TerminalLine[]> {
  const [action, arg] = args;
  if (!(await git.isGitRepo())) {
    return [line("stderr", "git: el core no esta en un repositorio git")];
  }
  if (action === "status" || !action) {
    const head = await git.currentCommit();
    const cfg = updater.getConfig();
    let behind = 0;
    try {
      await git.fetch(cfg.branch);
      behind = await git.behindCount(cfg.branch);
    } catch {
      /* sin remoto accesible */
    }
    return [
      line("info", "Estado git"),
      line("stdout", `  commit:   ${head ? `${head.shortHash} ${head.message}` : "(desconocido)"}`),
      line("stdout", `  rama:     ${cfg.branch}`),
      line(
        behind > 0 ? "info" : "stdout",
        `  remoto:   ${behind > 0 ? `${behind} commit(s) por aplicar` : "al dia"}`,
      ),
    ];
  }
  if (action === "log") {
    const n = Math.max(1, Math.min(50, Number(arg) || 10));
    const hist = await git.history(n);
    return hist.map((c) =>
      line("stdout", `  ${c.shortHash}  ${c.date.slice(0, 10)}  ${c.message}`),
    );
  }
  return [line("stderr", "wtm git: usa 'status' o 'log [n]'")];
}

async function rebuildCommand(
  user: User,
  emit: Emit | null,
): Promise<TerminalLine[]> {
  if (user.globalRole !== "superadmin") {
    return [line("stderr", "wtm rebuild: requiere superadmin")];
  }
  if (!emit) {
    return [line("stderr", "wtm rebuild: no disponible sin conexion en vivo")];
  }
  const sink: sysops.LineSink = (kind, text) => emit(line(kind, text));
  await sysops.rebuild(sink);
  return [];
}

async function restartCommand(
  user: User,
  rest: string[],
  emit: Emit | null,
): Promise<TerminalLine[]> {
  if (user.globalRole !== "superadmin") {
    return [line("stderr", "wtm restart: requiere superadmin")];
  }
  if (!emit) {
    return [line("stderr", "wtm restart: no disponible sin conexion en vivo")];
  }
  const withBuild = rest.includes("--build") || rest.includes("-b");
  const sink: sysops.LineSink = (kind, text) => emit(line(kind, text));
  await sysops.restart(sink, withBuild);
  return [];
}

async function updateCommand(
  user: User,
  rest: string[],
  emit: Emit | null,
): Promise<TerminalLine[]> {
  if (user.globalRole !== "superadmin") {
    return [line("stderr", "wtm update: requiere superadmin")];
  }
  const [action] = rest;
  if (action === "check") {
    const st = await updater.check();
    if (st.behind > 0) {
      return [
        line("info", `Hay ${st.behind} actualizacion(es) disponible(s).`),
        line("stdout", "Ejecuta 'wtm update apply' para instalarlas."),
      ];
    }
    return [line("stdout", "El sistema esta al dia.")];
  }
  if (action === "apply") {
    if (emit) emit(line("info", "Aplicando actualizacion... (el sistema se reiniciara)"));
    void updater.update();
    return emit
      ? []
      : [line("info", "Actualizacion en curso; el sistema se reiniciara.")];
  }
  return [line("stderr", "wtm update: usa 'check' o 'apply'")];
}

export function newTerminalSession(): Session {
  return { cwd: "/" };
}
