import { Router } from "express";
import type { AuthedRequest } from "../auth.js";
import { requireAuth } from "../auth.js";
import {
  listDefs,
  getDef,
  saveDef,
  deleteDef,
  validateDef,
  type DynamicModuleDef,
} from "./dynamic.js";

/**
 * Router del ESTUDIO DE MODULOS (modulo de sistema).
 *
 * Gestiona las definiciones de modulos dinamicos: listar, obtener, crear,
 * actualizar y eliminar. Solo superadmin/admin pueden modificar; cualquier
 * autenticado puede listar (para ver que hay).
 */

function isAdmin(req: AuthedRequest): boolean {
  const r = req.user?.globalRole;
  return r === "superadmin" || r === "admin";
}

export function estudioRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Listar definiciones.
  router.get("/modules", (_req, res) => {
    res.json({ ok: true, data: listDefs() });
  });

  // Obtener una definicion.
  router.get("/modules/:id", (req, res) => {
    const def = getDef(req.params.id);
    if (!def) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    res.json({ ok: true, data: def });
  });

  // Crear.
  router.post("/modules", (req: AuthedRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ ok: false, error: "Requiere administrador" });
      return;
    }
    const def = normalizeDef(req.body);
    const err = validateDef(def, { isNew: true });
    if (err) {
      res.status(400).json({ ok: false, error: err });
      return;
    }
    saveDef(def as DynamicModuleDef);
    res.json({ ok: true, data: def });
  });

  // Actualizar.
  router.put("/modules/:id", (req: AuthedRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ ok: false, error: "Requiere administrador" });
      return;
    }
    if (!getDef(req.params.id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    const def = normalizeDef({ ...req.body, id: req.params.id });
    const err = validateDef(def, { isNew: false });
    if (err) {
      res.status(400).json({ ok: false, error: err });
      return;
    }
    saveDef(def as DynamicModuleDef);
    res.json({ ok: true, data: def });
  });

  // Eliminar (con purga opcional de la tabla de datos).
  router.delete("/modules/:id", (req: AuthedRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ ok: false, error: "Requiere administrador" });
      return;
    }
    const purge = req.query.purge === "true";
    deleteDef(req.params.id, purge);
    res.json({ ok: true, data: { id: req.params.id, purged: purge } });
  });

  return router;
}

/** Rellena valores por defecto y limpia la definicion que llega del cliente. */
function normalizeDef(body: unknown): Partial<DynamicModuleDef> {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(b.fields) ? b.fields : [];
  return {
    id: String(b.id ?? "").trim().toLowerCase(),
    name: String(b.name ?? "").trim(),
    description: String(b.description ?? "").trim(),
    icon: String(b.icon ?? "boxes"),
    color: String(b.color ?? "#3f7d8c"),
    dataScope: b.dataScope === "company" ? "company" : "shared",
    category:
      (typeof b.category === "string"
        ? (b.category as DynamicModuleDef["category"])
        : "inventario") ?? "inventario",
    minLevel: clampLevel(b.minLevel, 1),
    writeLevel: clampLevel(b.writeLevel, 2),
    fields: fields.map((f) => {
      const ff = (f ?? {}) as Record<string, unknown>;
      return {
        key: String(ff.key ?? "").trim().toLowerCase(),
        label: String(ff.label ?? "").trim(),
        type: String(ff.type ?? "text") as DynamicModuleDef["fields"][number]["type"],
        required: !!ff.required,
        inList: ff.inList !== false,
        options: Array.isArray(ff.options)
          ? ff.options.map((o) => String(o)).filter(Boolean)
          : undefined,
      };
    }),
  };
}

function clampLevel(v: unknown, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, Math.round(n)));
}
