import { useCallback, useEffect, useMemo, useState } from "react";
import type { DynField, DynModuleDef, DynRecord, ModuleManifest } from "@wtm/shared";
import {
  Button,
  Input,
  ModuleBody,
  ModuleHeader,
  ModuleShell,
  Notice,
  Select,
  Toolbar,
  Spacer,
} from "@wtm/ui";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Icon";

/**
 * Vista generica para un MODULO DINAMICO (creado con el Estudio). Renderiza su
 * UI a partir de la definicion: una tabla de registros + un formulario para
 * crear/editar, con validacion segun el tipo de cada campo. No sabe nada del
 * modulo concreto: todo viene de la definicion que entrega el core.
 */
export function DynamicModule({ module }: { module: ModuleManifest }) {
  const { levelFor } = useAuth();
  const [def, setDef] = useState<DynModuleDef | null>(null);
  const [rows, setRows] = useState<DynRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DynRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const canWrite = def ? levelFor(module.id) >= (def.writeLevel || 2) : false;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.dynDef(module.id);
      setDef(d);
      setRows(await api.dynList(module.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el modulo");
    } finally {
      setLoading(false);
    }
  }, [module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const listFields = useMemo(
    () => (def?.fields ?? []).filter((f) => f.inList !== false),
    [def],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (def?.fields ?? []).some((f) =>
        String(r[f.key] ?? "").toLowerCase().includes(q),
      ),
    );
  }, [rows, query, def]);

  async function remove(r: DynRecord) {
    if (!confirm("¿Eliminar este registro?")) return;
    try {
      await api.dynDelete(module.id, r.id);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
  }

  async function onSaved() {
    closeForm();
    setRows(await api.dynList(module.id));
  }

  return (
    <ModuleShell moduleId={module.id}>
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title={module.name}
        subtitle={module.description}
      />

      <Toolbar>
        <Input
          placeholder="Buscar..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <Spacer />
        <Button variant="default" onClick={load} disabled={loading}>
          {loading ? "Cargando..." : "Actualizar"}
        </Button>
        {canWrite && (
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" size={14} /> Nuevo
          </Button>
        )}
      </Toolbar>

      <ModuleBody>
        {error && <Notice tone="error">{error}</Notice>}
        {!def && !loading && <Notice>Modulo sin definicion.</Notice>}

        {def && (creating || editing) && (
          <RecordForm
            def={def}
            moduleId={module.id}
            record={editing}
            onCancel={closeForm}
            onSaved={onSaved}
          />
        )}

        {def && !creating && !editing && (
          <>
            <div style={{ fontSize: 12, color: "var(--wtm-text-dim)", marginBottom: 8 }}>
              {filtered.length.toLocaleString()} registro(s)
            </div>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    {listFields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                    {canWrite && <th style={{ width: 90 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      {listFields.map((f) => (
                        <td key={f.key}>{formatCell(f, r[f.key])}</td>
                      ))}
                      {canWrite && (
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              className="ui-btn ui-btn--ghost"
                              style={{ padding: "2px 7px" }}
                              title="Editar"
                              onClick={() => {
                                setCreating(false);
                                setEditing(r);
                              }}
                            >
                              <Icon name="edit" size={13} />
                            </button>
                            <button
                              className="ui-btn ui-btn--ghost"
                              style={{ padding: "2px 7px" }}
                              title="Eliminar"
                              onClick={() => remove(r)}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={listFields.length + (canWrite ? 1 : 0)}
                        style={{ color: "var(--wtm-text-dim)", textAlign: "center", padding: 24 }}
                      >
                        Sin registros todavia.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ModuleBody>
    </ModuleShell>
  );
}

function formatCell(f: DynField, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "boolean") return v ? "Si" : "No";
  if (f.type === "money") return `$ ${Number(v).toLocaleString("es", { minimumFractionDigits: 2 })}`;
  if (f.type === "number") return Number(v).toLocaleString("es");
  return String(v);
}

// ================= Formulario de registro =================
function RecordForm({
  def,
  moduleId,
  record,
  onCancel,
  onSaved,
}: {
  def: DynModuleDef;
  moduleId: string;
  record: DynRecord | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of def.fields) {
      init[f.key] = record ? record[f.key] : f.type === "boolean" ? false : "";
    }
    return init;
  });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  function set(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function save() {
    // Validar requeridos en el cliente (el servidor tambien valida).
    for (const f of def.fields) {
      if (f.required) {
        const v = values[f.key];
        if (v === undefined || v === null || v === "") {
          setMsg(`El campo "${f.label}" es obligatorio.`);
          return;
        }
      }
    }
    setSaving(true);
    setMsg("");
    try {
      if (record) await api.dynUpdate(moduleId, record.id, values);
      else await api.dynCreate(moduleId, values);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>{record ? "Editar registro" : "Nuevo registro"}</h3>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div style={{ display: "grid", gap: 12 }}>
        {def.fields.map((f) => (
          <label key={f.key} style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
              {f.label}
              {f.required && <span style={{ color: "var(--wtm-danger)" }}> *</span>}
            </span>
            <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
        <Button variant="default" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DynField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          className="ui-input"
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: "vertical" }}
        />
      );
    case "number":
    case "money":
      return (
        <Input
          type="number"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "boolean":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>Si</span>
        </label>
      );
    case "select":
      return (
        <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— elegir —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    default:
      return (
        <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
