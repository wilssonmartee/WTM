import { Router, raw } from "express";
import path from "node:path";
import fs from "node:fs";
import type { WtmModule, ModuleContext } from "./types.js";
import { requireAuth, requireLevel } from "../auth.js";
import { config as coreConfig } from "../config.js";

/**
 * Modulo Articulos.
 *
 * El archivo DBF vive en el equipo del usuario y se procesa EN EL NAVEGADOR.
 * Para persistencia, el cliente sube el DBF COMPRIMIDO (gzip) al core, que lo
 * guarda en disco. Al abrir el sistema, el cliente descarga esa copia para
 * mostrar datos de inmediato; al pulsar "Actualizar" relee el archivo local y
 * re-sube.
 *
 * - Config (columnas/alias/orden/encoding/etiqueta de archivo): settings.
 * - DBF comprimido: data/modules/articulos/store.dbf.gz
 */
const CONFIG_KEY = "module.articulos.config";

function storeDir(): string {
  const dir = path.join(coreConfig.dataDir, "modules", "articulos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function storePath(): string {
  return path.join(storeDir(), "store.dbf.gz");
}

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
    npmDependencies: {},
  },

  migrate() {
    // Sin tablas: la config vive en settings.
  },

  drop(db) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(CONFIG_KEY);
    // Al purgar, borramos tambien el DBF guardado.
    try {
      fs.rmSync(storeDir(), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  },

  createRouter(ctx: ModuleContext): Router {
    const router = Router();
    router.use(requireAuth, requireLevel("articulos", 1));

    // --- Config ---
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
      // Indicamos si hay un DBF guardado y su tamano.
      let stored: { size: number; at: string } | null = null;
      try {
        const st = fs.statSync(storePath());
        stored = { size: st.size, at: st.mtime.toISOString() };
      } catch {
        stored = null;
      }
      res.json({ ok: true, data, stored });
    });

    router.put("/config", requireLevel("articulos", 2), (req, res) => {
      ctx.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(CONFIG_KEY, JSON.stringify(req.body ?? {}));
      res.json({ ok: true, data: req.body ?? {} });
    });

    // --- Subir DBF comprimido (gzip). Body binario crudo. Nivel 2+. ---
    router.put(
      "/data",
      requireLevel("articulos", 2),
      raw({ type: "application/octet-stream", limit: "200mb" }),
      (req, res) => {
        const body = req.body as Buffer;
        if (!body || !body.length) {
          res.status(400).json({ ok: false, error: "Sin datos" });
          return;
        }
        try {
          fs.writeFileSync(storePath(), body);
          res.json({
            ok: true,
            data: { size: body.length, at: new Date().toISOString() },
          });
        } catch (e) {
          res
            .status(500)
            .json({ ok: false, error: (e as Error).message });
        }
      },
    );

    // --- Descargar el DBF comprimido guardado (bytes gzip crudos). ---
    router.get("/data", (_req, res) => {
      const p = storePath();
      if (!fs.existsSync(p)) {
        res.status(404).json({ ok: false, error: "No hay DBF guardado" });
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Encoding", "identity"); // ya es gzip nuestro, no HTTP
      fs.createReadStream(p).pipe(res);
    });

    return router;
  },
};
