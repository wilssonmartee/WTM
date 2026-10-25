import type { TerminalLine, TerminalResult, User } from "@wtm/shared";
import { db } from "./db.js";
import { catalog, install, uninstall } from "./modules/registry.js";
import { config } from "./config.js";
import { WTM_VERSION } from "@wtm/shared";

/**
 * Interprete de la terminal del sistema WTM.
 *
 * No es una shell del sistema operativo real: es una shell acotada a WTM con
 * comandos de nombre familiar (estilo Linux) para navegar los datos de la
 * plataforma, inspeccionar modulos, la base de datos y el estado del sistema.
 *
 * El "sistema de archivos" es virtual y refleja la estructura logica de WTM:
 *   /                      raiz
 *   /empresas              una carpeta por empresa
 *   /modulos               modulos instalados/disponibles
 *   /sistema               info y logs del core
 */

interface Session {
  cwd: string;
}

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

export function runCommand(
  user: User,
  session: Session,
  raw: string,
): TerminalResult {
  const input = raw.trim();
  const lines: TerminalLine[] = [];
  if (!input) return { cwd: session.cwd, lines };

  const [cmd, ...args] = input.split(/\s+/);

  switch (cmd) {
    case "help":
      lines.push(
        line("info", "Comandos disponibles:"),
        line("stdout", "  help                 Esta ayuda"),
        line("stdout", "  pwd                  Directorio actual"),
        line("stdout", "  ls [ruta]            Listar contenido"),
        line("stdout", "  cd <ruta>            Cambiar de directorio"),
        line("stdout", "  clear                Limpiar pantalla"),
        line("stdout", "  whoami               Usuario actual"),
        line("stdout", "  wtm status           Estado del core"),
        line("stdout", "  wtm version          Version de WTM"),
        line("stdout", "  wtm pkg list         Listar modulos"),
        line("stdout", "  wtm db tables        Listar tablas de la base de datos"),
        line("stdout", "  wtm db count <tabla> Contar filas de una tabla"),
      );
      break;

    case "pwd":
      lines.push(line("stdout", session.cwd));
      break;

    case "whoami":
      lines.push(
        line("stdout", `${user.username} (${user.globalRole})`),
      );
      break;

    case "clear":
      return { cwd: session.cwd, lines: [{ kind: "info", text: "\f" }] };

    case "ls":
      lines.push(...lsCommand(session, args[0]));
      break;

    case "cd":
      lines.push(...cdCommand(session, args[0]));
      break;

    case "wtm":
      lines.push(...wtmCommand(user, args));
      break;

    case "echo":
      lines.push(line("stdout", args.join(" ")));
      break;

    default:
      lines.push(
        line("stderr", `comando no encontrado: ${cmd}. Escribe 'help'.`),
      );
  }

  return { cwd: session.cwd, lines };
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

function wtmCommand(user: User, args: string[]): TerminalLine[] {
  const [sub, ...rest] = args;
  switch (sub) {
    case "version":
      return [line("stdout", `WTM ${WTM_VERSION}`)];
    case "status":
      return [
        line("info", "Estado del core WTM"),
        line("stdout", `  version:   ${WTM_VERSION}`),
        line("stdout", `  puerto:    ${config.port}`),
        line("stdout", `  base datos: SQLite (${config.dbFile})`),
        line("stdout", `  modulos:   ${catalog().length}`),
        line("stdout", "  estado:    en linea"),
      ];
    case "pkg":
      return pkgCommand(user, rest);
    case "db":
      return dbCommand(rest);
    default:
      return [
        line(
          "stderr",
          `wtm: subcomando desconocido '${sub ?? ""}'. Prueba: status, version, pkg, db`,
        ),
      ];
  }
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

  // install / remove requieren superadmin.
  if (action === "install" || action === "remove") {
    if (user.globalRole !== "superadmin") {
      return [line("stderr", "wtm pkg: requiere superadmin")];
    }
    if (!target) {
      return [line("stderr", `wtm pkg ${action}: indica un modulo`)];
    }
    // install/remove pueden tardar (dependencias npm): se lanzan en segundo
    // plano. Usa 'wtm pkg list' para ver el resultado.
    if (action === "install") {
      install(target).catch(() => {});
      return [line("info", `Instalando '${target}'... (ver 'wtm pkg list')`)];
    }
    uninstall(target, false).catch(() => {});
    return [line("info", `Desinstalando '${target}'...`)];
  }

  if (action === "update") {
    return [
      line(
        "info",
        "La actualizacion desde el registro remoto llegara en una proxima version.",
      ),
    ];
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
    // Validar que la tabla exista para evitar inyeccion.
    const exists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      )
      .get(arg) as { name: string } | undefined;
    if (!exists) return [line("stderr", `db: no existe la tabla '${arg}'`)];
    const r = db.prepare(`SELECT COUNT(*) AS n FROM "${arg}"`).get() as {
      n: number;
    };
    return [line("stdout", `${arg}: ${r.n} filas`)];
  }
  return [
    line("stderr", "wtm db: usa 'tables' o 'count <tabla>'"),
  ];
}

export function newTerminalSession(): Session {
  return { cwd: "/" };
}
