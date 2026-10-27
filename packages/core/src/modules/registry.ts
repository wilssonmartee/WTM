import { Router, type Request, type Response } from "express";
import type { ModuleInfo, ModuleManifest } from "@wtm/shared";
import type { WtmModule } from "./types.js";
import { db } from "../db.js";
import { inventarioModule } from "./inventario.js";
import { articulosModule } from "./articulos.js";
import { PLACEHOLDER_MODULES } from "./placeholders.js";
import {
  addModuleDeps,
  removeModuleDeps,
  ensureModuleDeps,
} from "./deps.js";
import {
  initDynamic,
  dynamicManifests,
  dynamicRouter,
  isDynamic,
  deleteDef,
} from "./dynamic.js";
import { estudioRouter } from "./estudio.js";

/**
 * Registro de modulos del core.
 *
 * - AVAILABLE_MODULES: modulos reales con backend (migraciones + rutas).
 * - PLACEHOLDER_MODULES: entradas de catalogo aun sin backend (coming-soon),
 *   para que aparezcan en el escritorio.
 *
 * El estado de instalacion vive en la tabla installed_modules. Al instalar,
 * se corre migrate() y se registra. El router se monta dinamicamente: un unico
 * punto /api/m/:moduleId despacha al router del modulo si esta instalado.
 */

const AVAILABLE_MODULES: WtmModule[] = [inventarioModule, articulosModule];

// Routers construidos una vez (se despachan solo si el modulo esta instalado).
const routers = new Map<string, Router>();

export function initRegistry() {
  // Motor de modulos dinamicos: crea su tabla de definiciones y asegura las
  // tablas de datos de los modulos ya creados con el Estudio.
  initDynamic();

  for (const mod of AVAILABLE_MODULES) {
    // Si el modulo ya estaba instalado, aseguramos su esquema (idempotente).
    // No auto-instalamos nada: asi puedes probar el flujo de instalar/quitar
    // desde el menu de inicio (Inventario aparece con el boton "Instalar").
    if (isInstalled(mod.manifest.id)) {
      mod.migrate(db);
      // Reconciliar dependencias npm: si el modulo instalado gano nuevas
      // npmDependencies (p.ej. tras actualizar), o node_modules no las tiene
      // (deploy nuevo), instalarlas en segundo plano sin bloquear el arranque.
      if (
        mod.manifest.npmDependencies &&
        Object.keys(mod.manifest.npmDependencies).length > 0
      ) {
        ensureModuleDeps(mod.manifest.id, mod.manifest.npmDependencies)
          .then((r) => {
            if (r.installed.length)
              console.log(
                `[modules] ${mod.manifest.id}: dependencias instaladas ${r.installed.join(", ")}`,
              );
            if (r.errors.length)
              console.warn(
                `[modules] ${mod.manifest.id}: fallo instalar deps: ${r.errors.join("; ")}`,
              );
          })
          .catch((e) =>
            console.warn(
              `[modules] ${mod.manifest.id}: error reconciliando deps: ${e}`,
            ),
          );
      }
    }
    routers.set(
      mod.manifest.id,
      mod.createRouter({ db, dataScope: mod.manifest.dataScope }),
    );
  }
}

function findModule(id: string): WtmModule | undefined {
  return AVAILABLE_MODULES.find((m) => m.manifest.id === id);
}

export function isInstalled(id: string): boolean {
  // Los modulos dinamicos (creados con el Estudio) estan "instalados" por el
  // solo hecho de existir su definicion.
  if (isDynamic(id)) return true;
  return !!db
    .prepare("SELECT 1 FROM installed_modules WHERE id = ?")
    .get(id);
}

export function installedVersion(id: string): string | undefined {
  const row = db
    .prepare("SELECT version FROM installed_modules WHERE id = ?")
    .get(id) as { version: string } | undefined;
  return row?.version;
}

export async function install(
  id: string,
): Promise<{ ok: boolean; error?: string; deps?: string[] }> {
  const mod = findModule(id);
  if (!mod) return { ok: false, error: `Modulo desconocido: ${id}` };
  if (isInstalled(id)) return { ok: true };

  // Dependencias de modulo (otros modulos requeridos).
  for (const dep of mod.manifest.dependencies ?? []) {
    if (!isInstalled(dep)) {
      return { ok: false, error: `Falta la dependencia: ${dep}` };
    }
  }

  // Instalar dependencias npm del modulo (ref-count).
  let installedDeps: string[] = [];
  if (mod.manifest.npmDependencies) {
    const r = await addModuleDeps(id, mod.manifest.npmDependencies);
    if (r.errors.length > 0) {
      // Revertir el registro de deps si fallo la instalacion.
      await removeModuleDeps(id);
      return {
        ok: false,
        error: `No se pudieron instalar dependencias: ${r.errors.join("; ")}`,
      };
    }
    installedDeps = r.installed;
  }

  mod.migrate(db);
  db.prepare(
    "INSERT INTO installed_modules (id, version, installed_at) VALUES (?, ?, ?)",
  ).run(id, mod.manifest.version, new Date().toISOString());
  return { ok: true, deps: installedDeps };
}

export async function uninstall(
  id: string,
  purge: boolean,
): Promise<{ ok: boolean; error?: string; removedDeps?: string[] }> {
  // Modulos dinamicos (creados con el Estudio): su "desinstalacion" es borrar
  // su carpeta de archivos y, si purge, su tabla de datos. No estan en el array
  // estatico, por eso antes daba "Modulo desconocido".
  if (isDynamic(id)) {
    deleteDef(id, purge);
    return { ok: true, removedDeps: [] };
  }

  const mod = findModule(id);
  if (!mod) return { ok: false, error: `Modulo desconocido: ${id}` };
  if (!isInstalled(id)) return { ok: true };

  // No permitir desinstalar si otro modulo instalado depende de este.
  for (const other of AVAILABLE_MODULES) {
    if (
      other.manifest.id !== id &&
      isInstalled(other.manifest.id) &&
      (other.manifest.dependencies ?? []).includes(id)
    ) {
      return {
        ok: false,
        error: `${other.manifest.id} depende de ${id}`,
      };
    }
  }

  if (purge && mod.drop) mod.drop(db);
  db.prepare("DELETE FROM installed_modules WHERE id = ?").run(id);

  // Al PURGAR, soltamos sus dependencias npm (ref-count) y desinstalamos las
  // que ya nadie use. Al desinstalar sin purgar, conservamos las deps.
  let removedDeps: string[] = [];
  if (purge) {
    const r = await removeModuleDeps(id);
    removedDeps = r.removed;
  }
  return { ok: true, removedDeps };
}

/** Catalogo completo (reales + sistema + dinamicos) con estado de instalacion. */
export function catalog(): ModuleInfo[] {
  const real: ModuleManifest[] = AVAILABLE_MODULES.map((m) => m.manifest);
  const all = [...real, ...PLACEHOLDER_MODULES, ...dynamicManifests()];
  return all.map((m) => {
    // Los modulos de SISTEMA (terminal, ajustes) son parte del nucleo: estan
    // siempre disponibles, no se instalan ni se desinstalan.
    const builtin = m.category === "sistema";
    return {
      ...m,
      installed: builtin ? true : isInstalled(m.id),
      installedVersion: builtin ? m.version : installedVersion(m.id),
    };
  });
}

// El router del Estudio (modulo de sistema) se construye una vez.
let estudio: Router | null = null;

/** Router despachador: /api/m/:moduleId/* -> router del modulo instalado. */
export function moduleDispatcher(): Router {
  const router = Router({ mergeParams: true });
  router.use("/:moduleId", (req: Request, res: Response, next) => {
    const moduleId = (req.params as { moduleId: string }).moduleId;

    // Estudio de modulos: modulo de sistema para crear/editar modulos.
    if (moduleId === "estudio") {
      if (!estudio) estudio = estudioRouter();
      estudio(req, res, next);
      return;
    }

    // Modulos dinamicos (creados con el Estudio): router CRUD generico que se
    // construye al vuelo desde la definicion vigente (puede haber cambiado).
    if (isDynamic(moduleId)) {
      const dyn = dynamicRouter(moduleId);
      if (!dyn) {
        res.status(404).json({ ok: false, error: "Modulo dinamico invalido" });
        return;
      }
      dyn(req, res, next);
      return;
    }

    if (!isInstalled(moduleId)) {
      res.status(404).json({ ok: false, error: "Modulo no instalado" });
      return;
    }
    const r = routers.get(moduleId);
    if (!r) {
      res.status(404).json({ ok: false, error: "Modulo sin backend" });
      return;
    }
    r(req, res, next);
  });
  return router;
}
