import { Router } from "express";
import type { WtmModule, ModuleContext } from "./types.js";
import { requireAuth, requireLevel } from "../auth.js";

/**
 * Modulo Articulos.
 *
 * El archivo DBF vive en el equipo del usuario y se procesa EN EL NAVEGADOR
 * (nunca se sube al servidor). Por eso el backend solo guarda la configuracion
 * global del modulo (que columnas mostrar, alias, orden), no los datos.
 *
 * Config global en settings con clave "module.articulos.config".
 */
const CONFIG_KEY = "module.articulos.config";

export const articulosModule: WtmModule = {
  manifest: {
    id: "articulos",
    name: "Articulos",
    version: "0.1.0",
    description:
      "Lee archivos DBF locales, elige columnas, ordena y busca (con tildes y enies).",
    icon: "boxes",
    color: "#3f7d8c",
    dataScope: "shared",
    status: "available",
    category: "inventario",
    // El parseo DBF es en el navegador: no requiere dependencias de servidor.
    npmDependencies: {},
  },

  migrate() {
    // Sin tablas: la config vive en settings (clave/valor), ya existente.
  },

  drop(db) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(CONFIG_KEY);
  },

  createRouter(ctx: ModuleContext): Router {
    const router = Router();
    router.use(requireAuth, requireLevel("articulos", 1));

    // Leer la configuracion global del modulo.
    router.get("/config", (_req, res) => {
      const row = ctx.db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(CONFIG_KEY) as { value: string } | undefined;
      let data: unknown = null;
      if (row) {
        try {
          data = JSON.parse(row.value);
        } catch {
          data = null;
        }
      }
      res.json({ ok: true, data });
    });

    // Guardar la configuracion global (nivel 2+ para configurar).
    router.put("/config", requireLevel("articulos", 2), (req, res) => {
      ctx.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(CONFIG_KEY, JSON.stringify(req.body ?? {}));
      res.json({ ok: true, data: req.body ?? {} });
    });

    return router;
  },
};
