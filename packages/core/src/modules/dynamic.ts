import vm from "node:vm";
import type { ModuleManifest } from "@wtm/shared";
import { db } from "../db.js";
import { requireAuth, requireLevel, withCompany } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import { newId } from "../crypto.js";
import { Router } from "express";
import {
  moduleDir,
  moduleExists,
  listModuleDirs,
  readJson,
  writeFileText,
  readFileText,
  removeModuleDir,
  safeModuleId,
} from "./mstore.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Motor de MODULOS DINAMICOS basado en ARCHIVOS (estilo WordPress).
 *
 * Cada modulo vive como una CARPETA en data/modules/<id>/ con archivos reales
 * que el usuario puede editar desde la interfaz (editor de codigo):
 *   - manifest.json : metadatos (nombre, icono, color, alcance, permisos)
 *   - schema.json   : campos de datos (genera la tabla y los formularios)
 *   - logic.js      : hooks opcionales en JavaScript, ejecutados en un sandbox
 *   - *.md, etc.    : documentacion u otros archivos a gusto del autor
 *
 * El motor:
 *   - lee manifest + schema para armar el manifiesto y la tabla dyn_<id>,
 *   - monta un router CRUD generico en /api/m/<id>,
 *   - ejecuta logic.js (si existe) para hooks: validate, beforeSave,
 *     afterSave, compute.
 *
 * Guardar un archivo tiene efecto inmediato: el router se reconstruye en cada
 * peticion y la logica se re-evalua, sin recompilar el core.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "boolean"
  | "select";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  inList?: boolean;
}

export interface DynamicModuleDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  dataScope: "company" | "shared";
  category: ModuleManifest["category"];
  minLevel: number;
  writeLevel: number;
  fields: FieldDef[];
}

const IDENT = /^[a-z][a-z0-9_]{1,30}$/;
function safeIdent(s: string): boolean {
  return IDENT.test(s);
}

const RESERVED = new Set([
  "terminal",
  "ajustes",
  "actualizaciones",
  "estudio",
  "inventario",
  "articulos",
]);

// ============================================================
//  Lectura de definiciones desde archivos
// ============================================================

/** Lee la definicion de un modulo juntando manifest.json + schema.json. */
export function getDef(id: string): DynamicModuleDef | null {
  if (!moduleExists(id)) return null;
  const manifest = readJson<Partial<DynamicModuleDef>>(id, "manifest.json");
  if (!manifest) return null;
  const schema = readJson<{ fields: FieldDef[] }>(id, "schema.json");
  return {
    id,
    name: String(manifest.name ?? id),
    description: String(manifest.description ?? ""),
    icon: String(manifest.icon ?? "boxes"),
    color: String(manifest.color ?? "#3f7d8c"),
    dataScope: manifest.dataScope === "company" ? "company" : "shared",
    category: (manifest.category as DynamicModuleDef["category"]) ?? "inventario",
    minLevel: clampLevel(manifest.minLevel, 1),
    writeLevel: clampLevel(manifest.writeLevel, 2),
    fields: Array.isArray(schema?.fields) ? schema!.fields : [],
  };
}

export function listDefs(): DynamicModuleDef[] {
  const out: DynamicModuleDef[] = [];
  for (const id of listModuleDirs()) {
    const d = getDef(id);
    if (d) out.push(d);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function clampLevel(v: unknown, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, Math.round(n)));
}

// ============================================================
//  Inicializacion y migracion
// ============================================================

/**
 * Prepara el motor: migra definiciones viejas (que vivian en la tabla
 * dynamic_modules) a archivos, y asegura las tablas de datos de todos los
 * modulos presentes en disco.
 */
export function initDynamic(): void {
  migrateLegacyDefs();
  for (const def of listDefs()) ensureDataTable(def);
}

/**
 * Compatibilidad: si existe la tabla dynamic_modules de la version anterior,
 * vuelca cada definicion a su carpeta de archivos (manifest.json + schema.json
 * + logic.js + README.md) y luego deja de usarla.
 */
function migrateLegacyDefs(): void {
  const hasTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='dynamic_modules'",
    )
    .get();
  if (!hasTable) return;
  const rows = db
    .prepare("SELECT id, def FROM dynamic_modules")
    .all() as { id: string; def: string }[];
  for (const r of rows) {
    if (!safeModuleId(r.id)) continue;
    if (moduleExists(r.id)) continue; // ya migrado
    try {
      const def = JSON.parse(r.def) as DynamicModuleDef;
      scaffoldModuleFiles(def);
    } catch {
      /* definicion corrupta: se ignora */
    }
  }
  // Renombramos la tabla para no re-migrar (conserva los datos por si acaso).
  try {
    db.exec(
      "ALTER TABLE dynamic_modules RENAME TO dynamic_modules_legacy",
    );
  } catch {
    /* ya renombrada */
  }
}

// ============================================================
//  Tabla de datos
// ============================================================

function sqlType(t: FieldType): string {
  switch (t) {
    case "number":
    case "money":
      return "REAL";
    case "boolean":
      return "INTEGER";
    default:
      return "TEXT";
  }
}

function dataTable(id: string): string {
  return `dyn_${id}`;
}

/** Crea/actualiza la tabla de datos (agrega columnas nuevas, no destruye). */
export function ensureDataTable(def: DynamicModuleDef): void {
  if (!safeIdent(def.id)) return;
  const t = dataTable(def.id);
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${t}" (
      id         TEXT PRIMARY KEY,
      company_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const cols = (
    db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]
  ).map((c) => c.name);
  for (const f of def.fields) {
    if (!safeIdent(f.key)) continue;
    if (!cols.includes(f.key)) {
      db.exec(`ALTER TABLE "${t}" ADD COLUMN "${f.key}" ${sqlType(f.type)};`);
    }
  }
}

// ============================================================
//  Validacion
// ============================================================

export function validateDef(
  def: Partial<DynamicModuleDef>,
  { isNew }: { isNew: boolean },
): string | null {
  if (!def.id || !safeIdent(def.id)) {
    return "El identificador debe empezar por letra y usar solo minusculas, numeros o guion bajo (2-31).";
  }
  if (RESERVED.has(def.id)) {
    return `El identificador '${def.id}' esta reservado por el sistema.`;
  }
  if (isNew && moduleExists(def.id)) {
    return `Ya existe un modulo con el identificador '${def.id}'.`;
  }
  if (!def.name || !def.name.trim()) return "El nombre es obligatorio.";
  if (!Array.isArray(def.fields) || def.fields.length === 0) {
    return "Define al menos un campo de datos.";
  }
  const seen = new Set<string>();
  for (const f of def.fields) {
    if (!f.key || !safeIdent(f.key)) {
      return `Clave de campo invalida: '${f.key}'. Usa minusculas, numeros o guion bajo.`;
    }
    if (f.key === "id" || f.key === "company_id") {
      return `La clave '${f.key}' esta reservada.`;
    }
    if (seen.has(f.key)) return `Clave de campo repetida: '${f.key}'.`;
    seen.add(f.key);
    if (!f.label || !f.label.trim()) {
      return `El campo '${f.key}' necesita una etiqueta.`;
    }
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      return `El campo '${f.key}' es una seleccion pero no tiene opciones.`;
    }
  }
  return null;
}

// ============================================================
//  Escribir definiciones a archivos
// ============================================================

/** Crea/actualiza los archivos base de un modulo desde su definicion. */
export function scaffoldModuleFiles(def: DynamicModuleDef): void {
  const dir = moduleDir(def.id);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.icon,
    color: def.color,
    dataScope: def.dataScope,
    category: def.category,
    minLevel: def.minLevel,
    writeLevel: def.writeLevel,
    version: "1.0.0",
  };
  writeFileText(def.id, "manifest.json", JSON.stringify(manifest, null, 2));
  writeFileText(
    def.id,
    "schema.json",
    JSON.stringify({ fields: def.fields }, null, 2),
  );

  // Solo creamos logic.js y README la primera vez (no pisar lo del usuario).
  if (!fs.existsSync(path.join(dir, "logic.js"))) {
    writeFileText(def.id, "logic.js", DEFAULT_LOGIC_JS);
  }
  if (!fs.existsSync(path.join(dir, "README.md"))) {
    writeFileText(
      def.id,
      "README.md",
      `# ${def.name}\n\n${def.description || "Modulo creado con el Estudio de WTM."}\n`,
    );
  }
}

/** Guarda SOLO la definicion (manifest + schema) y asegura la tabla. */
export function saveDef(def: DynamicModuleDef): void {
  scaffoldModuleFiles(def);
  ensureDataTable(def);
}

/** Elimina el modulo: borra su carpeta y (si purge) su tabla de datos. */
export function deleteDef(id: string, purge: boolean): void {
  removeModuleDir(id);
  if (purge && safeIdent(id)) {
    db.exec(`DROP TABLE IF EXISTS "${dataTable(id)}";`);
  }
}

export function dynamicManifests(): ModuleManifest[] {
  return listDefs().map(
    (d): ModuleManifest => ({
      id: d.id,
      name: d.name,
      version: "1.0.0",
      description: d.description,
      icon: d.icon || "boxes",
      color: d.color || "#3f7d8c",
      dataScope: d.dataScope,
      status: "available",
      category: d.category,
      minLevel: Math.max(1, Math.min(10, d.minLevel || 1)) as ModuleManifest["minLevel"],
    }),
  );
}

export function isDynamic(id: string): boolean {
  return moduleExists(id);
}

// ============================================================
//  Sandbox de logica (logic.js)
// ============================================================

/**
 * Ejecuta un hook de logic.js en un contexto AISLADO (node:vm). El script del
 * usuario expone un objeto con funciones hook; aqui lo evaluamos y llamamos al
 * hook pedido con un contexto seguro. Sin acceso a require, process, fs, red:
 * solo datos del registro y utilidades basicas.
 *
 * Hooks soportados (todos opcionales):
 *   validate(record, ctx)   -> string|null  (mensaje de error o null si OK)
 *   beforeSave(record, ctx) -> record       (transforma antes de guardar)
 *   afterSave(record, ctx)  -> void
 *   compute(record, ctx)    -> record       (campos calculados al listar)
 */
type Hook = "validate" | "beforeSave" | "afterSave" | "compute";

interface HookCtx {
  action: "create" | "update" | "list";
  user: string;
  companyId: string | null;
  now: string;
}

const scriptCache = new Map<string, { mtime: number; hooks: Record<string, unknown> }>();

function loadHooks(id: string): Record<string, unknown> {
  const file = path.join(moduleDir(id), "logic.js");
  if (!fs.existsSync(file)) return {};
  const stat = fs.statSync(file);
  const cached = scriptCache.get(id);
  if (cached && cached.mtime === stat.mtimeMs) return cached.hooks;

  const code = fs.readFileSync(file, "utf8");
  // El modulo expone sus hooks asignando a `module.exports` o devolviendo un
  // objeto. Envolvemos el codigo del usuario en una funcion.
  const sandbox: Record<string, unknown> = {
    module: { exports: {} },
    exports: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
  };
  try {
    const context = vm.createContext(sandbox);
    const wrapped = `(function(module, exports){ "use strict";\n${code}\n})(module, exports);`;
    const script = new vm.Script(wrapped, { filename: `${id}/logic.js` });
    script.runInContext(context, { timeout: 1000 });
    const hooks =
      ((sandbox.module as { exports?: Record<string, unknown> }).exports as
        | Record<string, unknown>
        | undefined) ||
      (sandbox.exports as Record<string, unknown>) ||
      {};
    scriptCache.set(id, { mtime: stat.mtimeMs, hooks });
    return hooks;
  } catch {
    // logic.js con error de sintaxis: lo ignoramos (el CRUD sigue funcionando).
    scriptCache.set(id, { mtime: stat.mtimeMs, hooks: {} });
    return {};
  }
}

function runHook(
  id: string,
  hook: Hook,
  record: Record<string, unknown>,
  ctx: HookCtx,
): unknown {
  const hooks = loadHooks(id);
  const fn = hooks[hook];
  if (typeof fn !== "function") return hook === "validate" ? null : record;
  try {
    const sandbox: Record<string, unknown> = {
      __fn: fn,
      __record: record,
      __ctx: ctx,
      Math,
      Date,
      JSON,
    };
    const context = vm.createContext(sandbox);
    const script = new vm.Script("__fn(__record, __ctx)");
    return script.runInContext(context, { timeout: 1000 });
  } catch (e) {
    if (hook === "validate") return `Error en la logica: ${(e as Error).message}`;
    return record;
  }
}

// ============================================================
//  Router CRUD generico
// ============================================================

export function dynamicRouter(id: string): Router | null {
  const def = getDef(id);
  if (!def) return null;
  const t = dataTable(id);
  const router = Router();
  const scoped = def.dataScope === "company";
  router.use(
    requireAuth,
    withCompany(scoped),
    requireLevel(id, def.minLevel || 1),
  );

  const fieldKeys = def.fields.filter((f) => safeIdent(f.key)).map((f) => f.key);

  function coerce(f: FieldDef, v: unknown): unknown {
    if (v === undefined || v === null || v === "") {
      return f.type === "boolean" ? 0 : null;
    }
    if (f.type === "number" || f.type === "money") return Number(v) || 0;
    if (f.type === "boolean") return v ? 1 : 0;
    return String(v);
  }

  // Listar.
  router.get("/records", (req: AuthedRequest, res) => {
    const where = scoped ? "WHERE company_id = ?" : "";
    const params = scoped ? [req.companyId] : [];
    let rows = db
      .prepare(`SELECT * FROM "${t}" ${where} ORDER BY created_at DESC`)
      .all(...params) as Record<string, unknown>[];
    // Hook compute: agrega campos calculados a cada fila (no se persisten).
    const ctx: HookCtx = {
      action: "list",
      user: req.user?.username ?? "",
      companyId: req.companyId ?? null,
      now: new Date().toISOString(),
    };
    rows = rows.map((r) => {
      const computed = runHook(id, "compute", { ...r }, ctx);
      return computed && typeof computed === "object"
        ? (computed as Record<string, unknown>)
        : r;
    });
    res.json({ ok: true, data: rows });
  });

  // Crear.
  router.post(
    "/records",
    requireLevel(id, def.writeLevel || 2),
    (req: AuthedRequest, res) => {
      let body = (req.body ?? {}) as Record<string, unknown>;
      const ctx: HookCtx = {
        action: "create",
        user: req.user?.username ?? "",
        companyId: req.companyId ?? null,
        now: new Date().toISOString(),
      };
      // Requeridos.
      for (const f of def.fields) {
        if (f.required) {
          const v = body[f.key];
          if (v === undefined || v === null || v === "") {
            res
              .status(400)
              .json({ ok: false, error: `El campo '${f.label}' es obligatorio` });
            return;
          }
        }
      }
      // Hook validate.
      const verr = runHook(id, "validate", { ...body }, ctx);
      if (typeof verr === "string" && verr) {
        res.status(400).json({ ok: false, error: verr });
        return;
      }
      // Hook beforeSave.
      const transformed = runHook(id, "beforeSave", { ...body }, ctx);
      if (transformed && typeof transformed === "object") {
        body = transformed as Record<string, unknown>;
      }

      const now = ctx.now;
      const recId = newId();
      const cols = ["id", "company_id", "created_at", "updated_at", ...fieldKeys];
      const vals: unknown[] = [
        recId,
        scoped ? req.companyId : null,
        now,
        now,
        ...def.fields
          .filter((f) => safeIdent(f.key))
          .map((f) => coerce(f, body[f.key])),
      ];
      const placeholders = cols.map(() => "?").join(", ");
      const colList = cols.map((c) => `"${c}"`).join(", ");
      db.prepare(
        `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`,
      ).run(...vals);
      const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(recId) as Record<
        string,
        unknown
      >;
      runHook(id, "afterSave", { ...row }, ctx);
      res.json({ ok: true, data: row });
    },
  );

  // Actualizar.
  router.put(
    "/records/:rid",
    requireLevel(id, def.writeLevel || 2),
    (req: AuthedRequest, res) => {
      let body = (req.body ?? {}) as Record<string, unknown>;
      const existing = db
        .prepare(`SELECT * FROM "${t}" WHERE id = ?`)
        .get(req.params.rid) as Record<string, unknown> | undefined;
      if (!existing) {
        res.status(404).json({ ok: false, error: "Registro no encontrado" });
        return;
      }
      if (scoped && existing.company_id !== req.companyId) {
        res.status(403).json({ ok: false, error: "No pertenece a la empresa" });
        return;
      }
      const ctx: HookCtx = {
        action: "update",
        user: req.user?.username ?? "",
        companyId: req.companyId ?? null,
        now: new Date().toISOString(),
      };
      const verr = runHook(id, "validate", { ...existing, ...body }, ctx);
      if (typeof verr === "string" && verr) {
        res.status(400).json({ ok: false, error: verr });
        return;
      }
      const transformed = runHook(id, "beforeSave", { ...body }, ctx);
      if (transformed && typeof transformed === "object") {
        body = transformed as Record<string, unknown>;
      }
      const sets = def.fields
        .filter((f) => safeIdent(f.key))
        .map((f) => `"${f.key}" = ?`);
      const vals = def.fields
        .filter((f) => safeIdent(f.key))
        .map((f) => coerce(f, body[f.key]));
      db.prepare(
        `UPDATE "${t}" SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
      ).run(...vals, ctx.now, req.params.rid);
      const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(req.params.rid) as Record<
        string,
        unknown
      >;
      runHook(id, "afterSave", { ...row }, ctx);
      res.json({ ok: true, data: row });
    },
  );

  // Eliminar.
  router.delete(
    "/records/:rid",
    requireLevel(id, def.writeLevel || 2),
    (req, res) => {
      db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(req.params.rid);
      res.json({ ok: true, data: { id: req.params.rid } });
    },
  );

  // Definicion (para que el frontend sepa como pintar la UI).
  router.get("/def", (_req, res) => {
    res.json({ ok: true, data: def });
  });

  return router;
}

// Plantilla inicial de logic.js que ve el usuario al crear un modulo.
const DEFAULT_LOGIC_JS = `// Logica del modulo (opcional). Se ejecuta en un entorno seguro y aislado.
// Puedes definir cualquiera de estos "hooks". Todos reciben (record, ctx).
//   ctx = { action: 'create'|'update'|'list', user, companyId, now }
//
// Descomenta y edita lo que necesites. Guardar aplica los cambios al instante.

module.exports = {
  // Validar antes de guardar. Devuelve un texto de error, o null si todo OK.
  // validate: function (record, ctx) {
  //   if (Number(record.precio) < 0) return "El precio no puede ser negativo";
  //   return null;
  // },

  // Transformar el registro justo antes de guardarlo.
  // beforeSave: function (record, ctx) {
  //   if (record.nombre) record.nombre = String(record.nombre).toUpperCase();
  //   return record;
  // },

  // Agregar campos calculados al listar (no se guardan en la base).
  // compute: function (record, ctx) {
  //   record._resumen = (record.nombre || "") + " - " + (record.precio || 0);
  //   return record;
  // },
};
`;
