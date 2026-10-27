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
  isBuiltinEditable,
  listBuiltinFiles,
  readBuiltinFile,
  writeBuiltinFile,
} from "./mstore.js";
import { rebuild } from "../sysops.js";
import { catalog } from "./registry.js";

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

  // ---- Catalogo UNIFICADO: todos los modulos editables ----
  // Dinamicos (archivos en data/modules) + compilados editables (inventario,
  // articulos). Asi el Estudio puede listar y abrir CUALQUIER modulo.
  router.get("/all", (_req, res) => {
    const cat = catalog();
    const out = cat
      .filter((m) => m.category !== "sistema") // los de sistema no se editan aqui
      .map((m) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        color: m.color,
        description: m.description,
        kind: moduleExists(m.id)
          ? "dynamic"
          : isBuiltinEditable(m.id)
            ? "builtin"
            : "other",
        editableFiles: moduleExists(m.id) || isBuiltinEditable(m.id),
      }));
    res.json({ ok: true, data: out });
  });

  // ---- ARCHIVOS del modulo (editor estilo WordPress) ----
  // Funciona para modulos DINAMICOS (data/modules/<id>) y COMPILADOS
  // (packages/core/src/modules/<id>.ts). El flag ?builtin=true selecciona
  // los archivos fuente del modulo compilado.

  function isBuiltinReq(req: AuthedRequest, id: string): boolean {
    return req.query.builtin === "true" || (!moduleExists(id) && isBuiltinEditable(id));
  }

  // Listar archivos de un modulo.
  router.get("/files/:id", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    if (!safeModuleId(id)) {
      res.status(400).json({ ok: false, error: "Identificador invalido" });
      return;
    }
    if (isBuiltinReq(req, id)) {
      if (!isBuiltinEditable(id)) {
        res.status(404).json({ ok: false, error: "Modulo no editable" });
        return;
      }
      res.json({ ok: true, data: listBuiltinFiles(id) });
      return;
    }
    if (!moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
    res.json({ ok: true, data: listFiles(id) });
  });

  // Leer el contenido de un archivo.
  router.get("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const rel = String(req.query.path ?? "");
    try {
      const content = isBuiltinReq(req, id)
        ? readBuiltinFile(id, rel)
        : readFileText(id, rel);
      res.json({ ok: true, data: { path: rel, content } });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Guardar un archivo.
  router.put("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const { path: rel, content } = (req.body ?? {}) as {
      path?: string;
      content?: string;
    };
    if (!rel || typeof content !== "string") {
      res.status(400).json({ ok: false, error: "Falta path o content" });
      return;
    }
    try {
      if (isBuiltinReq(req, id)) {
        writeBuiltinFile(id, rel, content);
        res.json({ ok: true, data: { path: rel, needsRebuild: true } });
      } else {
        writeFileText(id, rel, content);
        res.json({ ok: true, data: { path: rel, needsRebuild: false } });
      }
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // Borrar un archivo del modulo (solo dinamicos).
  router.delete("/files/:id/content", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    const id = req.params.id;
    const rel = String(req.query.path ?? "");
    if (!safeModuleId(id) || !moduleExists(id)) {
      res.status(404).json({ ok: false, error: "Modulo no encontrado" });
      return;
    }
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

  // Recompilar el sistema (tras editar un modulo compilado). Devuelve de
  // inmediato; el progreso real se puede ver con el Terminal (wtm rebuild).
  router.post("/rebuild", (req: AuthedRequest, res) => {
    if (!guardAdmin(req, res)) return;
    res.json({ ok: true, data: { started: true } });
    void rebuild(() => {});
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
