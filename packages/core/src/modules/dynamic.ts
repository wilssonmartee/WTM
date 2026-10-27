import { Router } from "express";
import type { Database } from "better-sqlite3";
import type { ModuleManifest } from "@wtm/shared";
import { db } from "../db.js";
import { requireAuth, requireLevel, withCompany } from "../auth.js";
import type { AuthedRequest } from "../auth.js";
import { newId } from "../crypto.js";

/**
 * Motor de MODULOS DINAMICOS.
 *
 * Permite crear modulos de negocio SIN escribir codigo ni recompilar: la
 * definicion (campos de datos + metadatos) se guarda en la base de datos y el
 * motor genera, en runtime:
 *   - una tabla de datos (dyn_<id>) con una columna por campo,
 *   - un router CRUD generico montado en /api/m/<id>,
 *   - el manifiesto para que el modulo aparezca en el escritorio.
 *
 * El Estudio de modulos (modulo de sistema) es la UI para crear/editar estas
 * definiciones. La UI de cada modulo creado es una vista dinamica generica
 * (lista + formulario) en el frontend.
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
  /** Clave de columna (identificador seguro: letras, numeros, guion bajo). */
  key: string;
  /** Etiqueta visible. */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Para "select": opciones disponibles. */
  options?: string[];
  /** Mostrar en la tabla de listado. */
  inList?: boolean;
}

export interface DynamicModuleDef {
  id: string; // identificador del modulo (slug)
  name: string;
  description: string;
  icon: string;
  color: string;
  dataScope: "company" | "shared";
  category: ModuleManifest["category"];
  minLevel: number;
  fields: FieldDef[];
  /** Nivel minimo para crear/editar/borrar registros (vs solo ver). */
  writeLevel: number;
}

const TABLE = "dynamic_modules";

/** Crea la tabla de definiciones si no existe. */
export function initDynamic(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id          TEXT PRIMARY KEY,
      def         TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);
  // Asegurar las tablas de datos de todos los modulos ya definidos.
  for (const def of listDefs()) ensureDataTable(def);
}

// ---- Validacion de identificadores (evita inyeccion SQL) ----
const IDENT = /^[a-z][a-z0-9_]{1,30}$/;

function safeIdent(s: string): boolean {
  return IDENT.test(s);
}

// Nombres reservados: no permitir chocar con modulos reales ni de sistema.
const RESERVED = new Set([
  "terminal",
  "ajustes",
  "actualizaciones",
  "estudio",
  "inventario",
  "articulos",
]);

// ---- Persistencia de definiciones ----
export function listDefs(): DynamicModuleDef[] {
  const rows = db
    .prepare(`SELECT def FROM ${TABLE} ORDER BY id`)
    .all() as { def: string }[];
  const out: DynamicModuleDef[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.def) as DynamicModuleDef);
    } catch {
      /* definicion corrupta: la ignoramos */
    }
  }
  return out;
}

export function getDef(id: string): DynamicModuleDef | null {
  const row = db
    .prepare(`SELECT def FROM ${TABLE} WHERE id = ?`)
    .get(id) as { def: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.def) as DynamicModuleDef;
  } catch {
    return null;
  }
}

/** Valida una definicion. Devuelve el primer error o null si es valida. */
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
  if (isNew && getDef(def.id)) {
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

/** Tipo de columna SQLite para cada tipo de campo. */
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

/**
 * Crea/actualiza la tabla de datos del modulo. Agrega columnas nuevas (no
 * borra ni cambia tipo de las existentes, para no perder datos). SQLite
 * soporta ALTER TABLE ADD COLUMN.
 */
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

/** Guarda (crea o reemplaza) una definicion y asegura su tabla. */
export function saveDef(def: DynamicModuleDef): void {
  const now = new Date().toISOString();
  const exists = !!db
    .prepare(`SELECT 1 FROM ${TABLE} WHERE id = ?`)
    .get(def.id);
  if (exists) {
    db.prepare(
      `UPDATE ${TABLE} SET def = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(def), now, def.id);
  } else {
    db.prepare(
      `INSERT INTO ${TABLE} (id, def, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(def.id, JSON.stringify(def), now, now);
  }
  ensureDataTable(def);
}

/** Elimina una definicion. Si purge, borra tambien su tabla de datos. */
export function deleteDef(id: string, purge: boolean): void {
  db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
  if (purge && safeIdent(id)) {
    db.exec(`DROP TABLE IF EXISTS "${dataTable(id)}";`);
  }
}

/** Manifiestos de todos los modulos dinamicos (para el catalogo). */
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

/** ¿Este id corresponde a un modulo dinamico? */
export function isDynamic(id: string): boolean {
  return !!getDef(id);
}

// ---- Router CRUD generico de un modulo dinamico ----
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
    const rows = db
      .prepare(`SELECT * FROM "${t}" ${where} ORDER BY created_at DESC`)
      .all(...params);
    res.json({ ok: true, data: rows });
  });

  // Crear.
  router.post(
    "/records",
    requireLevel(id, def.writeLevel || 2),
    (req: AuthedRequest, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
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
      // Validar requeridos.
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
      const placeholders = cols.map(() => "?").join(", ");
      const colList = cols.map((c) => `"${c}"`).join(", ");
      db.prepare(
        `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`,
      ).run(...vals);
      const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(recId);
      res.json({ ok: true, data: row });
    },
  );

  // Actualizar.
  router.put(
    "/records/:rid",
    requireLevel(id, def.writeLevel || 2),
    (req: AuthedRequest, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
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
      const sets = def.fields
        .filter((f) => safeIdent(f.key))
        .map((f) => `"${f.key}" = ?`);
      const vals = def.fields
        .filter((f) => safeIdent(f.key))
        .map((f) => coerce(f, body[f.key]));
      db.prepare(
        `UPDATE "${t}" SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
      ).run(...vals, new Date().toISOString(), req.params.rid);
      const row = db.prepare(`SELECT * FROM "${t}" WHERE id = ?`).get(req.params.rid);
      res.json({ ok: true, data: row });
    },
  );

  // Eliminar.
  router.delete(
    "/records/:rid",
    requireLevel(id, def.writeLevel || 2),
    (req: AuthedRequest, res) => {
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

export type { Database };
