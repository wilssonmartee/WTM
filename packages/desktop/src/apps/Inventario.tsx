import { useCallback, useEffect, useState } from "react";
import type { ModuleManifest } from "@wtm/shared";
import {
  Button,
  CardGrid,
  Input,
  ModuleBody,
  ModuleHeader,
  ModuleShell,
  Notice,
  StatCard,
  Table,
  Tag,
  Toolbar,
  Spacer,
} from "@wtm/ui";
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
 * Inventario: ejemplo de modulo construido con el kit @wtm/ui.
 * Fijate que NO hay HTML de estilo ni clases de diseno: solo componentes del
 * kit + los datos. Toda la estetica viene del tema del layout.
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
    await api.moduleCall(`inventario`, `/products/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <ModuleShell moduleId="inventario">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title={module.name}
        subtitle={module.description}
      />

      <Toolbar>
        <Button variant="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancelar" : "Nuevo producto"}
        </Button>
        <Button onClick={load}>Actualizar</Button>
        <Spacer />
        <Tag>Datos compartidos entre empresas</Tag>
      </Toolbar>

      <ModuleBody>
        {error && <Notice tone="error">{error}</Notice>}

        {summary && (
          <CardGrid>
            <StatCard value={summary.products} label="Productos" />
            <StatCard value={summary.lowStock} label="Bajo stock" />
            <StatCard value={summary.warehouses} label="Almacenes" />
          </CardGrid>
        )}

        {adding && (
          <form
            onSubmit={createProduct}
            style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}
          >
            <Input
              style={{ width: 130 }}
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              required
            />
            <Input
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              style={{ width: 130 }}
              placeholder="Almacen"
              value={form.warehouse}
              onChange={(e) => setForm({ ...form, warehouse: e.target.value })}
            />
            <Input
              style={{ width: 90 }}
              type="number"
              placeholder="Stock"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
            <Button variant="primary" type="submit">
              Guardar
            </Button>
          </form>
        )}

        {loading ? (
          <Notice>Cargando...</Notice>
        ) : (
          <Table
            columns={[
              "SKU",
              "Producto",
              "Almacen",
              "Stock",
              "Estado",
              <span style={{ float: "right" }}>Acciones</span>,
            ]}
          >
            {products.map((p) => {
              const out = p.stock === 0;
              const low = p.stock <= p.min_stock;
              return (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.warehouse}</td>
                  <td>{p.stock.toLocaleString()}</td>
                  <td>
                    {out ? (
                      <Tag tone="danger">Agotado</Tag>
                    ) : low ? (
                      <Tag tone="warn">Bajo</Tag>
                    ) : (
                      <Tag tone="ok">OK</Tag>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button
                      variant="ghost"
                      style={{ padding: "3px 9px" }}
                      onClick={() => adjust(p.id, 1)}
                    >
                      +1
                    </Button>{" "}
                    <Button
                      variant="ghost"
                      style={{ padding: "3px 9px" }}
                      onClick={() => adjust(p.id, -1)}
                    >
                      -1
                    </Button>{" "}
                    <Button
                      variant="ghost"
                      style={{ padding: "3px 9px" }}
                      onClick={() => remove(p.id)}
                    >
                      Eliminar
                    </Button>
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
          </Table>
        )}
      </ModuleBody>
    </ModuleShell>
  );
}
