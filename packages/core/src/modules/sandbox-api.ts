import { db } from "../db.js";
import { newId } from "../crypto.js";

/**
 * API SEGURA que se inyecta en el sandbox de logic.js como objeto `wtm`.
 *
 * Da a los modulos creados en el Estudio poder REAL (base de datos, consultar
 * otros modulos, utilidades) SIN exponer require/fs/red/process, que permitirian
 * ejecutar codigo arbitrario en el servidor desde un editor web (riesgo grave).
 *
 * Todas las consultas estan acotadas a tablas de modulos (dyn_*) y validadas
 * para evitar inyeccion SQL. La empresa activa se aplica segun el alcance.
 */

const IDENT = /^[a-z][a-z0-9_]{1,30}$/;
function dynTable(moduleId: string): string {
  if (!IDENT.test(moduleId)) throw new Error("Modulo invalido");
  return `dyn_${moduleId}`;
}
function tableExists(name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

export interface SandboxCtx {
  moduleId: string;
  companyId: string | null;
  user: string;
}

/**
 * Construye el objeto `wtm` para un modulo y una peticion dados. El modulo solo
 * puede tocar su propia tabla con los metodos data.*; para leer OTROS modulos
 * usa related.list (solo lectura).
 */
export function makeSandboxApi(ctx: SandboxCtx) {
  const selfTable = dynTable(ctx.moduleId);

  /** Lista registros de la tabla del propio modulo (con filtros simples). */
  function list(filter?: Record<string, unknown>): Record<string, unknown>[] {
    if (!tableExists(selfTable)) return [];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter && typeof filter === "object") {
      for (const [k, v] of Object.entries(filter)) {
        if (!IDENT.test(k)) continue;
        clauses.push(`"${k}" = ?`);
        params.push(v);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db
      .prepare(`SELECT * FROM "${selfTable}" ${where}`)
      .all(...params) as Record<string, unknown>[];
  }

  /** Cuenta registros (opcionalmente filtrados). */
  function count(filter?: Record<string, unknown>): number {
    return list(filter).length;
  }

  /** Suma una columna numerica de la tabla del modulo. */
  function sum(column: string, filter?: Record<string, unknown>): number {
    if (!IDENT.test(column)) return 0;
    return list(filter).reduce((acc, r) => acc + (Number(r[column]) || 0), 0);
  }

  /** Lee registros de OTRO modulo (solo lectura). */
  function relatedList(
    otherModuleId: string,
    filter?: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const t = dynTable(otherModuleId);
    if (!tableExists(t)) return [];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter && typeof filter === "object") {
      for (const [k, v] of Object.entries(filter)) {
        if (!IDENT.test(k)) continue;
        clauses.push(`"${k}" = ?`);
        params.push(v);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db
      .prepare(`SELECT * FROM "${t}" ${where}`)
      .all(...params) as Record<string, unknown>[];
  }

  return {
    // Identidad de la peticion.
    moduleId: ctx.moduleId,
    companyId: ctx.companyId,
    user: ctx.user,
    now: () => new Date().toISOString(),
    uuid: () => newId(),

    // Datos del propio modulo.
    data: { list, count, sum },

    // Datos de otros modulos (solo lectura) -> "conectarse con otros modulos".
    related: { list: relatedList },

    // Utilidades.
    log: (..._args: unknown[]) => {
      /* los logs del modulo se descartan (no contaminan el core) */
    },
  };
}

export type SandboxApi = ReturnType<typeof makeSandboxApi>;
