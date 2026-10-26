import { spawn } from "node:child_process";
import { db } from "../db.js";
import { REPO_ROOT } from "../updater/git.js";

/**
 * Gestor de dependencias de modulos, estilo package manager con conteo de
 * referencias.
 *
 * - Cada modulo declara sus npmDependencies.
 * - Al instalar un modulo: por cada dependencia, se registra que ese modulo la
 *   requiere (ref-count +1) y se instala si aun no esta.
 * - Al purgar un modulo: se quita su referencia (ref-count -1). Si una
 *   dependencia queda sin ningun modulo que la use, se desinstala.
 *
 * El registro de "quien requiere que" vive en la tabla module_deps.
 * Las dependencias del CORE (las del Dockerfile) nunca se tocan: solo
 * gestionamos las declaradas por modulos.
 */

export interface DepResult {
  installed: string[];
  removed: string[];
  errors: string[];
}

function runNpm(args: string[]): Promise<{ ok: boolean; detail: string }> {
  // --no-save: las dependencias de MODULOS NO deben escribirse en el
  // package.json raiz. Si lo hicieran, el core las veria como propias y el
  // ref-counting nunca las desinstalaria al purgar. El estado real de "quien
  // las usa" vive en la tabla module_deps; su presencia, en node_modules.
  const full =
    args[0] === "install" || args[0] === "uninstall"
      ? [args[0], "--no-save", ...args.slice(1)]
      : args;
  return new Promise((resolve) => {
    const child = spawn("npm", full, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (out += b.toString()));
    child.on("close", (code) =>
      resolve({ ok: code === 0, detail: out.slice(-2000) }),
    );
    child.on("error", (e) => resolve({ ok: false, detail: e.message }));
  });
}

/** Modulos (distintos) que actualmente requieren un paquete. */
function refsFor(pkg: string): string[] {
  return (
    db
      .prepare("SELECT module_id FROM module_deps WHERE package = ?")
      .all(pkg) as { module_id: string }[]
  ).map((r) => r.module_id);
}

/** Si el paquete ya figura en el package.json raiz (dependencies). */
function isInRootPackageJson(pkg: string): boolean {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const json = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    return !!(json.dependencies && json.dependencies[pkg]);
  } catch {
    return false;
  }
}

/**
 * Registra las dependencias de un modulo e instala las que falten.
 * Devuelve que se instalo y errores. Idempotente.
 */
export async function addModuleDeps(
  moduleId: string,
  deps: Record<string, string>,
): Promise<DepResult> {
  const result: DepResult = { installed: [], removed: [], errors: [] };
  const entries = Object.entries(deps ?? {});
  if (entries.length === 0) return result;

  const insRef = db.prepare(
    "INSERT OR REPLACE INTO module_deps (module_id, package, version) VALUES (?, ?, ?)",
  );

  for (const [pkg, version] of entries) {
    const hadRefs = refsFor(pkg).length > 0;
    insRef.run(moduleId, pkg, version);
    // Instalar solo si no estaba ya (ni como dep del core ni de otro modulo).
    if (!hadRefs && !isInRootPackageJson(pkg)) {
      const r = await runNpm(["install", `${pkg}@${version}`]);
      if (r.ok) result.installed.push(`${pkg}@${version}`);
      else result.errors.push(`install ${pkg}: ${r.detail}`);
    }
  }
  return result;
}

/**
 * Quita las referencias de un modulo y desinstala los paquetes que queden
 * sin usar por ningun otro modulo (y que no sean del core).
 */
export async function removeModuleDeps(
  moduleId: string,
): Promise<DepResult> {
  const result: DepResult = { installed: [], removed: [], errors: [] };
  const own = db
    .prepare("SELECT package FROM module_deps WHERE module_id = ?")
    .all(moduleId) as { package: string }[];

  db.prepare("DELETE FROM module_deps WHERE module_id = ?").run(moduleId);

  for (const { package: pkg } of own) {
    const stillUsed = refsFor(pkg).length > 0;
    if (!stillUsed && !isInRootPackageJson(pkg)) {
      const r = await runNpm(["uninstall", pkg]);
      if (r.ok) result.removed.push(pkg);
      else result.errors.push(`uninstall ${pkg}: ${r.detail}`);
    }
  }
  return result;
}

/** Si el paquete esta fisicamente presente en node_modules. */
function isPhysicallyInstalled(pkg: string): boolean {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    // Soporta scoped (@scope/name) y normal.
    const dir = path.join(REPO_ROOT, "node_modules", ...pkg.split("/"));
    return fs.existsSync(path.join(dir, "package.json"));
  } catch {
    return false;
  }
}

/**
 * Reconcilia las dependencias de un modulo YA instalado: registra las refs que
 * falten e instala los paquetes que no esten fisicamente presentes en
 * node_modules. Util al arrancar el core cuando un modulo instalado gano nuevas
 * npmDependencies en una actualizacion, o tras un deploy nuevo sin node_modules
 * del modulo. Idempotente y silencioso ante errores (no bloquea el arranque).
 */
export async function ensureModuleDeps(
  moduleId: string,
  deps: Record<string, string>,
): Promise<DepResult> {
  const result: DepResult = { installed: [], removed: [], errors: [] };
  const entries = Object.entries(deps ?? {});
  if (entries.length === 0) return result;

  const insRef = db.prepare(
    "INSERT OR REPLACE INTO module_deps (module_id, package, version) VALUES (?, ?, ?)",
  );

  for (const [pkg, version] of entries) {
    insRef.run(moduleId, pkg, version); // asegura la referencia
    if (!isInRootPackageJson(pkg) && !isPhysicallyInstalled(pkg)) {
      const r = await runNpm(["install", `${pkg}@${version}`]);
      if (r.ok) result.installed.push(`${pkg}@${version}`);
      else result.errors.push(`install ${pkg}: ${r.detail}`);
    }
  }
  return result;
}

/** Diagnostico: lista dependencias de modulos y cuantos las usan. */
export function listModuleDeps(): {
  package: string;
  version: string;
  modules: string[];
}[] {
  const rows = db
    .prepare("SELECT package, version, module_id FROM module_deps ORDER BY package")
    .all() as { package: string; version: string; module_id: string }[];
  const map = new Map<string, { version: string; modules: string[] }>();
  for (const r of rows) {
    const e = map.get(r.package) ?? { version: r.version, modules: [] };
    e.modules.push(r.module_id);
    map.set(r.package, e);
  }
  return [...map.entries()].map(([pkg, e]) => ({
    package: pkg,
    version: e.version,
    modules: e.modules,
  }));
}
