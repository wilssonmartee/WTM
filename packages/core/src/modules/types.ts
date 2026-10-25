import type { Router } from "express";
import type { Database } from "better-sqlite3";
import type { ModuleManifest } from "@wtm/shared";

/**
 * Contrato de un modulo de WTM (backend).
 *
 * Un modulo declara su manifiesto, el SQL para crear/eliminar sus tablas, y
 * un router de Express que el core monta en /api/m/<id> cuando el modulo esta
 * instalado. Desinstalar desmonta el router (y opcionalmente borra los datos).
 *
 * Esta es la base para que mas adelante los modulos puedan vivir como paquetes
 * descargables: el formato (manifiesto + migraciones + rutas) sera el mismo,
 * solo cambiara de donde se cargan.
 */
export interface WtmModule {
  manifest: ModuleManifest;

  /** SQL que crea las tablas del modulo (idempotente, CREATE IF NOT EXISTS). */
  migrate(db: Database): void;

  /** SQL que elimina las tablas del modulo (al desinstalar con purga). */
  drop?(db: Database): void;

  /**
   * Construye el router del modulo. Recibe utilidades del core, incluida la
   * forma de acotar consultas por empresa segun el dataScope del modulo.
   */
  createRouter(ctx: ModuleContext): Router;
}

export interface ModuleContext {
  db: Database;
  /** Alcance de datos del modulo (company | shared). */
  dataScope: ModuleManifest["dataScope"];
}
