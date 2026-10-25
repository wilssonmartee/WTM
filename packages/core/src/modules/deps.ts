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
  return new Promise((resolve) => {
    const child = spawn("npm", args, {
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
