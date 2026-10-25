import { Router } from "express";
import type { WtmModule, ModuleContext } from "./types.js";
import type { AuthedRequest } from "../auth.js";
import { requireAuth, withCompany, requireLevel } from "../auth.js";
import { newId } from "../crypto.js";

/**
 * Modulo Inventario — primer modulo de negocio real de WTM.
 *
 * dataScope "shared": los productos se comparten entre las empresas del
 * servidor (segun el ejemplo: inventario compartido, facturacion aislada).
 * Por eso las consultas NO filtran por empresa. Si quisieramos aislarlo,
 * bastaria con cambiar dataScope a "company" y filtrar por company_id.
 */
export const inventarioModule: WtmModule = {
  manifest: {
    id: "inventario",
    name: "Inventario",
    version: "0.1.0",
    description:
      "Control de stock y productos. Puede compartir datos entre empresas.",
    icon: "boxes",
    color: "#9a7b3f",
    dataScope: "shared",
    status: "available",
    category: "inventario",
  },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inv_products (
        id          TEXT PRIMARY KEY,
        sku         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        warehouse   TEXT NOT NULL DEFAULT 'Central',
        stock       INTEGER NOT NULL DEFAULT 0,
        min_stock   INTEGER NOT NULL DEFAULT 0,
        price       REAL NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `);

    // Datos de ejemplo la primera vez.
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM inv_products")
      .get() as { n: number };
    if (count.n === 0) {
      const now = new Date().toISOString();
      const ins = db.prepare(
        `INSERT INTO inv_products
         (id, sku, name, warehouse, stock, min_stock, price, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const seed: [string, string, string, number, number, number][] = [
        ["SKU-1001", "Tornillo 1/4", "Central", 5200, 500, 0.05],
        ["SKU-1002", "Cable 2mm (m)", "Central", 12, 50, 0.9],
        ["SKU-1003", "Pintura blanca 1L", "Sucursal 1", 340, 40, 8.5],
        ["SKU-1004", "Broca 6mm", "Sucursal 2", 0, 10, 2.3],
      ];
      for (const [sku, name, wh, stock, min, price] of seed) {
        ins.run(newId(), sku, name, wh, stock, min, price, now, now);
      }
    }
  },

  drop(db) {
    db.exec("DROP TABLE IF EXISTS inv_products;");
  },

  createRouter(ctx: ModuleContext): Router {
    const router = Router();
    // Inventario es compartido: la empresa es opcional (no filtra datos).
    // requireLevel("inventario", 1): hace falta al menos un permiso (nivel 1).
    router.use(requireAuth, withCompany(false), requireLevel("inventario", 1));

    // Listar productos.
    router.get("/products", (_req, res) => {
      const rows = ctx.db
        .prepare("SELECT * FROM inv_products ORDER BY sku")
        .all();
      res.json({ ok: true, data: rows });
    });

    // Resumen para el tablero.
    router.get("/summary", (_req, res) => {
      const total = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM inv_products")
        .get() as { n: number };
      const low = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM inv_products WHERE stock <= min_stock",
        )
        .get() as { n: number };
      const warehouses = ctx.db
        .prepare(
          "SELECT COUNT(DISTINCT warehouse) AS n FROM inv_products",
        )
        .get() as { n: number };
      res.json({
        ok: true,
        data: {
          products: total.n,
          lowStock: low.n,
          warehouses: warehouses.n,
        },
      });
    });

    // Crear producto.
    router.post("/products", (req: AuthedRequest, res) => {
      const { sku, name, warehouse, stock, minStock, price } = req.body ?? {};
      if (typeof sku !== "string" || typeof name !== "string" || !sku || !name) {
        res.status(400).json({ ok: false, error: "sku y name son obligatorios" });
        return;
      }
      const exists = ctx.db
        .prepare("SELECT 1 FROM inv_products WHERE sku = ?")
        .get(sku);
      if (exists) {
        res.status(409).json({ ok: false, error: "El SKU ya existe" });
        return;
      }
      const now = new Date().toISOString();
      const id = newId();
      ctx.db
        .prepare(
          `INSERT INTO inv_products
           (id, sku, name, warehouse, stock, min_stock, price, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          sku,
          name,
          typeof warehouse === "string" && warehouse ? warehouse : "Central",
          Number(stock) || 0,
          Number(minStock) || 0,
          Number(price) || 0,
          now,
          now,
        );
      const row = ctx.db
        .prepare("SELECT * FROM inv_products WHERE id = ?")
        .get(id);
      res.json({ ok: true, data: row });
    });

    // Actualizar stock.
    router.patch("/products/:id/stock", (req, res) => {
      const delta = Number(req.body?.delta);
      if (!Number.isFinite(delta)) {
        res.status(400).json({ ok: false, error: "delta invalido" });
        return;
      }
      const row = ctx.db
        .prepare("SELECT stock FROM inv_products WHERE id = ?")
        .get(req.params.id) as { stock: number } | undefined;
      if (!row) {
        res.status(404).json({ ok: false, error: "Producto no encontrado" });
        return;
      }
      const next = Math.max(0, row.stock + delta);
      ctx.db
        .prepare(
          "UPDATE inv_products SET stock = ?, updated_at = ? WHERE id = ?",
        )
        .run(next, new Date().toISOString(), req.params.id);
      res.json({ ok: true, data: { id: req.params.id, stock: next } });
    });

    // Eliminar producto.
    router.delete("/products/:id", (req, res) => {
      ctx.db
        .prepare("DELETE FROM inv_products WHERE id = ?")
        .run(req.params.id);
      res.json({ ok: true, data: { id: req.params.id } });
    });

    return router;
  },
};
