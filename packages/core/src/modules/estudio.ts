import { Router } from "express";
import type { AuthedRequest } from "../auth.js";
import { requireAuth } from "../auth.js";
import {
  listDefs,
  getDef,
  saveDef,
  deleteDef,
  validateDef,
  scaffoldModuleFiles,
  type DynamicModuleDef,
} from "./dynamic.js";
import {
  listFiles,
  readFileText,
  writeFileText,
  deleteFile,
  moduleExists,
  safeModuleId,
} from "./mstore.js";

/**
 * Router del ESTUDIO DE MODULOS (modulo de sistema).
 *
 * Dos capas:
 *  - Definiciones (manifest + schema) via el constructor visual.
 *  - ARCHIVOS: listar/leer/escribir/borrar cualquier archivo de un modulo,
 *    como el editor de temas/plugins de WordPress. Solo admin/superadmin.
 */

function isAdmin(req: AuthedRequest): boolean {
  const r = req.user?.globalRole;
  return r === "superadmin" || r === "admin";
}

function guardAdmin(req: AuthedRequest, res: import("express").Response): boolean {
  if (!isAdmin(req)) {
    res.status(403).json({ ok: false, error: "Requiere administrador" });
    return false;
  }
  return true;
}

export function estudioRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // ---- Definiciones (constructor visual) ----
  router.get("/modules", (_req, res) => {
    res.json({ ok: true, data: listDefs() });
  });

  router.get("/modules/:id", (req, res) => {
    const def = getDef(req.params.id);
    if (!def) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    res.json({ ok: true, data: def });
  });

  router.post("/modules", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const def = normalizeDef(req.body);
    const err = validateDef(def, { isNew: true });
    if (err) {
      res.status(400).json({ ok: false, error: err });
      return;
    }
    saveDef(def as DynamicModuleDef);
    scaffoldModuleFiles(def as DynamicModuleDef);
    res.json({ ok: true, data: def });
  });

  router.put("/modules/:id", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
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

  router.delete("/modules/:id", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const purge = req.query.purge === "true";
    deleteDef(req.params.id, purge);
    res.json({ ok: true, data: { id: req.params.id, purged: purge } });
  });

  // ---- ARCHIVOS del modulo (editor estilo WordPress) ----

  // Listar archivos de un modulo.
  router.get("/files/:id", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    if (!safeModuleId(id) || !moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    res.json({ ok: true, data: listFiles(id) });
  });

  // Leer el contenido de un archivo. La ruta del archivo va como query (?path=).
  router.get("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const rel = String(req.query.path ?? "");
    if (!safeModuleId(id) || !moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    try {
      res.json({ ok: true, data: { path: rel, content: readFileText(id, rel) } });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Guardar (crear o sobrescribir) un archivo.
  router.put("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const { path: rel, content } = (req.body ?? {}) as {
      path?: string;
      content?: string;
    };
    if (!safeModuleId(id) || !moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    if (!rel || typeof content !== "string") {
      res.status(400).json({ ok: false, error: "Falta path o content" });
      return;
    }
    try {
      writeFileText(id, rel, content);
      res.json({ ok: true, data: { path: rel } });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Borrar un archivo del modulo.
  router.delete("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const rel = String(req.query.path ?? "");
    if (!safeModuleId(id) || !moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    // No permitir borrar los archivos nucleo del modulo.
    if (rel === "manifest.json" || rel === "schema.json") {
      res.status(400).json({ ok: false, error: "Ese archivo no se puede borrar" });
      return;
    }
    try {
      deleteFile(id, rel);
      res.json({ ok: true, data: { path: rel } });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}

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
