import { useCallback, useEffect, useState } from "react";
import type { DynField, DynMetric, DynView } from "@wtm/shared";
import { Button, Field, Input, Notice, Select } from "@wtm/ui";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

/**
 * Editor VISUAL de la vista de un modulo (view.json) sin tocar codigo: define
 * el modo de presentacion (tabla/tarjetas), tarjetas de metricas, el orden por
 * defecto y un aviso. Guarda en view.json; la vista del modulo lo aplica.
 */

const AGGS: { value: DynMetric["agg"]; label: string }[] = [
  { value: "count", label: "Cantidad (contar registros)" },
  { value: "sum", label: "Suma de un campo" },
  { value: "avg", label: "Promedio de un campo" },
  { value: "min", label: "Minimo de un campo" },
  { value: "max", label: "Maximo de un campo" },
];

export function ViewEditor({
  moduleId,
  fields,
}: {
  moduleId: string;
  fields: DynField[];
}) {
  const [view, setView] = useState<DynView>({ layout: "table", metrics: [] });
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Campos numericos (para metricas sum/avg/min/max).
  const numFields = fields.filter((f) => f.type === "number" || f.type === "money");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.estudioReadFile(moduleId, "view.json");
      const parsed = JSON.parse(r.content || "{}") as DynView;
      setView({
        layout: parsed.layout === "cards" ? "cards" : "table",
        metrics: Array.isArray(parsed.metrics) ? parsed.metrics : [],
        sortBy: parsed.sortBy ?? "",
        sortDir: parsed.sortDir === "asc" ? "asc" : "desc",
        cardTitle: parsed.cardTitle ?? "",
        banner: parsed.banner ?? "",
      });
    } catch {
      setView({ layout: "table", metrics: [] });
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof DynView>(key: K, value: DynView[K]) {
    setView((v) => ({ ...v, [key]: value }));
  }

  function addMetric() {
    set("metrics", [
      ...(view.metrics ?? []),
      { label: "Total", agg: "count" },
    ]);
  }
  function updateMetric(i: number, patch: Partial<DynMetric>) {
    set(
      "metrics",
      (view.metrics ?? []).map((m, j) => (j === i ? { ...m, ...patch } : m)),
    );
  }
  function removeMetric(i: number) {
    set("metrics", (view.metrics ?? []).filter((_, j) => j !== i));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.estudioWriteFile(
        moduleId,
        "view.json",
        JSON.stringify(view, null, 2),
      );
      setMsg({ tone: "success", text: "Vista guardada. Abre el modulo para verla." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Notice>Cargando vista...</Notice>;

  return (
    <div style={{ maxWidth: 680 }}>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <h3 style={h3}>Presentacion</h3>
      <div style={grid2}>
        <Field label="Modo de vista">
          <Select
            value={view.layout ?? "table"}
            onChange={(e) => set("layout", e.target.value as DynView["layout"])}
          >
            <option value="table">Tabla</option>
            <option value="cards">Tarjetas</option>
          </Select>
        </Field>
        {view.layout === "cards" && (
          <Field label="Campo para el titulo de cada tarjeta">
            <Select
              value={view.cardTitle ?? ""}
              onChange={(e) => set("cardTitle", e.target.value)}
            >
              <option value="">(primer campo)</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div style={grid2}>
        <Field label="Ordenar por">
          <Select value={view.sortBy ?? ""} onChange={(e) => set("sortBy", e.target.value)}>
            <option value="">(mas reciente)</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Direccion">
          <Select
            value={view.sortDir ?? "desc"}
            onChange={(e) => set("sortDir", e.target.value as "asc" | "desc")}
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </Select>
        </Field>
      </div>

      <Field label="Aviso en la parte superior (opcional)">
        <Input
          value={view.banner ?? ""}
          onChange={(e) => set("banner", e.target.value)}
          placeholder="Ej: Recuerda registrar cada venta al cierre del dia"
        />
      </Field>

      <h3 style={h3}>Tarjetas de metricas (resumen arriba)</h3>
      <Notice>
        Cada metrica es una tarjeta con un numero: contar registros, sumar o
        promediar un campo numerico. Aparecen sobre el listado del modulo.
      </Notice>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {(view.metrics ?? []).map((m, i) => (
          <div key={i} className="wtm-estudio-field">
            <Input
              value={m.label}
              placeholder="Etiqueta"
              onChange={(e) => updateMetric(i, { label: e.target.value })}
              style={{ flex: 1, minWidth: 110 }}
            />
            <Select
              value={m.agg}
              onChange={(e) => updateMetric(i, { agg: e.target.value as DynMetric["agg"] })}
              style={{ width: 180 }}
            >
              {AGGS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
            {m.agg !== "count" && (
              <Select
                value={m.field ?? ""}
                onChange={(e) => updateMetric(i, { field: e.target.value })}
                style={{ width: 150 }}
              >
                <option value="">(campo)</option>
                {numFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
            <Input
              value={m.prefix ?? ""}
              placeholder="pre"
              onChange={(e) => updateMetric(i, { prefix: e.target.value })}
              style={{ width: 54 }}
              title="Prefijo (ej: $)"
            />
            <button
              className="ui-btn ui-btn--ghost"
              style={{ padding: "2px 7px" }}
              onClick={() => removeMetric(i)}
              title="Quitar"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
      <Button variant="default" onClick={addMetric} style={{ marginTop: 10 }}>
        <Icon name="plus" size={13} /> Agregar metrica
      </Button>

      <div style={{ marginTop: 18 }}>
        <Button variant="primary" onClick={save} disabled={saving}>
          <Icon name="save" size={14} /> {saving ? "Guardando..." : "Guardar vista"}
        </Button>
      </div>
    </div>
  );
}

const h3: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--wtm-text-dim)",
  margin: "20px 0 10px",
};
const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};
