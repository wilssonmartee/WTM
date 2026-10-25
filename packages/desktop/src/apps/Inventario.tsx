import { useCallback, useEffect, useState } from "react";
import type { ModuleManifest } from "@wtm/shared";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";

interface Product {
  id: string;
  sku: string;
  name: string;
  warehouse: string;
  stock: number;
  min_stock: number;
  price: number;
}

interface Summary {
  products: number;
  lowStock: number;
  warehouses: number;
}

/**
 * UI real del modulo Inventario. Consume /api/m/inventario del core.
 * Es la prueba end-to-end del sistema de modulos: datos reales en la DB,
 * API del modulo montada dinamicamente, y esta vista conectada.
 */
export function Inventario({ module }: { module: ModuleManifest }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", warehouse: "", stock: "0" });

  const load = useCallback(async () => {
    setError("");
    try {
      const [p, s] = await Promise.all([
        api.moduleCall<Product[]>("inventario", "/products"),
        api.moduleCall<Summary>("inventario", "/summary"),
      ]);
      setProducts(p);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.moduleCall("inventario", "/products", {
        method: "POST",
        body: JSON.stringify({
          sku: form.sku,
          name: form.name,
          warehouse: form.warehouse || "Central",
          stock: Number(form.stock) || 0,
        }),
      });
      setForm({ sku: "", name: "", warehouse: "", stock: "0" });
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear");
    }
  }

  async function adjust(id: string, delta: number) {
    await api.moduleCall(`inventario`, `/products/${id}/stock`, {
      method: "PATCH",
      body: JSON.stringify({ delta }),
    });
    await load();
  }

  async function remove(id: string) {
    await api.moduleCall(`inventario`, `/products/${id}`, {
      method: "DELETE",
    });
    await load();
  }

  return (
    <div className="wtm-module">
      <div className="wtm-module__head">
        <div className="wtm-module__icon" style={{ background: module.color }}>
          <Icon name={module.icon} size={20} />
        </div>
        <div className="wtm-module__title">
          <h2>{module.name}</h2>
          <p>{module.description}</p>
        </div>
      </div>

      <div className="wtm-toolbar">
        <button
          className="wtm-tool wtm-tool--primary"
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? "Cancelar" : "Nuevo producto"}
        </button>
        <button className="wtm-tool" onClick={load}>
          Actualizar
        </button>
        <div style={{ flex: 1 }} />
        <span className="wtm-chip">Datos compartidos entre empresas</span>
      </div>

      <div className="wtm-module__content">
        {error && <div className="wtm-notice">{error}</div>}

        {summary && (
          <div className="wtm-cards">
            <div className="wtm-card">
              <div className="wtm-card__value">{summary.products}</div>
              <div className="wtm-card__label">Productos</div>
            </div>
            <div className="wtm-card">
              <div className="wtm-card__value">{summary.lowStock}</div>
              <div className="wtm-card__label">Bajo stock</div>
            </div>
            <div className="wtm-card">
              <div className="wtm-card__value">{summary.warehouses}</div>
              <div className="wtm-card__label">Almacenes</div>
            </div>
          </div>
        )}

        {adding && (
          <form
            onSubmit={createProduct}
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
              flexWrap: "wrap",
            }}
          >
            <input
              className="wtm-input"
              style={{ width: 130 }}
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              required
            />
            <input
              className="wtm-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="wtm-input"
              style={{ width: 130 }}
              placeholder="Almacen"
              value={form.warehouse}
              onChange={(e) => setForm({ ...form, warehouse: e.target.value })}
            />
            <input
              className="wtm-input"
              style={{ width: 90 }}
              type="number"
              placeholder="Stock"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
            <button className="wtm-tool wtm-tool--primary" type="submit">
              Guardar
            </button>
          </form>
        )}

        {loading ? (
          <div className="wtm-notice">Cargando...</div>
        ) : (
          <table className="wtm-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th>Almacen</th>
                <th>Stock</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const low = p.stock <= p.min_stock;
                const out = p.stock === 0;
                return (
                  <tr key={p.id}>
                    <td>{p.sku}</td>
                    <td>{p.name}</td>
                    <td>{p.warehouse}</td>
                    <td>{p.stock.toLocaleString()}</td>
                    <td>
                      {out ? (
                        <span className="wtm-tag wtm-tag--warn">Agotado</span>
                      ) : low ? (
                        <span className="wtm-tag wtm-tag--warn">Bajo</span>
                      ) : (
                        <span className="wtm-tag wtm-tag--ok">OK</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        className="wtm-tool"
                        onClick={() => adjust(p.id, 1)}
                        style={{ padding: "3px 8px" }}
                      >
                        +1
                      </button>{" "}
                      <button
                        className="wtm-tool"
                        onClick={() => adjust(p.id, -1)}
                        style={{ padding: "3px 8px" }}
                      >
                        -1
                      </button>{" "}
                      <button
                        className="wtm-tool"
                        onClick={() => remove(p.id)}
                        style={{ padding: "3px 8px" }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    Sin productos. Crea el primero.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
