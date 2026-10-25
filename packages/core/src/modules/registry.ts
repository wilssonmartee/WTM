import { Router, type Request, type Response } from "express";
import type { ModuleInfo, ModuleManifest } from "@wtm/shared";
import type { WtmModule } from "./types.js";
import { db } from "../db.js";
import { inventarioModule } from "./inventario.js";
import { PLACEHOLDER_MODULES } from "./placeholders.js";

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

const AVAILABLE_MODULES: WtmModule[] = [inventarioModule];

// Routers construidos una vez (se despachan solo si el modulo esta instalado).
const routers = new Map<string, Router>();

export function initRegistry() {
  for (const mod of AVAILABLE_MODULES) {
    // Si el modulo ya estaba instalado, aseguramos su esquema (idempotente).
    // No auto-instalamos nada: asi puedes probar el flujo de instalar/quitar
    // desde el menu de inicio (Inventario aparece con el boton "Instalar").
    if (isInstalled(mod.manifest.id)) {
      mod.migrate(db);
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

export function install(id: string): { ok: boolean; error?: string } {
  const mod = findModule(id);
  if (!mod) return { ok: false, error: `Modulo desconocido: ${id}` };
  if (isInstalled(id)) return { ok: true };

  // Dependencias.
  for (const dep of mod.manifest.dependencies ?? []) {
    if (!isInstalled(dep)) {
      return { ok: false, error: `Falta la dependencia: ${dep}` };
    }
  }

  mod.migrate(db);
  db.prepare(
    "INSERT INTO installed_modules (id, version, installed_at) VALUES (?, ?, ?)",
  ).run(id, mod.manifest.version, new Date().toISOString());
  return { ok: true };
}

export function uninstall(
  id: string,
  purge: boolean,
): { ok: boolean; error?: string } {
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
  return { ok: true };
}

/** Catalogo completo (reales + placeholders) con estado de instalacion. */
export function catalog(): ModuleInfo[] {
  const real: ModuleManifest[] = AVAILABLE_MODULES.map((m) => m.manifest);
  const all = [...real, ...PLACEHOLDER_MODULES];
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

/** Router despachador: /api/m/:moduleId/* -> router del modulo instalado. */
export function moduleDispatcher(): Router {
  const router = Router({ mergeParams: true });
  router.use("/:moduleId", (req: Request, res: Response, next) => {
    const moduleId = (req.params as { moduleId: string }).moduleId;
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
