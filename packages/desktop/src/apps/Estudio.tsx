import { useCallback, useEffect, useState } from "react";
import type {
  DynField,
  DynFieldType,
  DynModuleDef,
  ModuleManifest,
} from "@wtm/shared";
import {
  Button,
  Field,
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
import { FileManager } from "./estudio/FileManager";
import { ViewEditor } from "./estudio/ViewEditor";

/**
 * ESTUDIO DE MODULOS — crea y edita modulos del sistema sin programar.
 *
 * Pensado para que alguien con pocos conocimientos tecnicos arme un modulo
 * sencillo: elige una plantilla o parte de cero, define los campos de datos
 * con un constructor visual, y al guardar el modulo aparece en el escritorio
 * con su tabla y formularios ya funcionando.
 *
 * Para usuarios mas avanzados, muestra la "definicion" (el codigo declarativo
 * en JSON) que respalda al modulo, con explicaciones.
 */

type View = "lista" | "editor" | "ayuda";

const FIELD_TYPES: { value: DynFieldType; label: string; hint: string }[] = [
  { value: "text", label: "Texto corto", hint: "Nombres, codigos, etiquetas" },
  { value: "textarea", label: "Texto largo", hint: "Notas, descripciones" },
  { value: "number", label: "Numero", hint: "Cantidades, conteos" },
  { value: "money", label: "Dinero", hint: "Precios, importes" },
  { value: "date", label: "Fecha", hint: "Fechas de vencimiento, etc." },
  { value: "boolean", label: "Si/No", hint: "Activo, pagado, entregado..." },
  { value: "select", label: "Lista de opciones", hint: "Elegir entre valores" },
];

const ICON_CHOICES = [
  "boxes",
  "users",
  "receipt",
  "shopping-cart",
  "calculator",
  "bar-chart",
  "database",
  "home",
  "settings",
];

const CATEGORIES: { value: DynModuleDef["category"]; label: string }[] = [
  { value: "ventas", label: "Ventas" },
  { value: "inventario", label: "Inventario" },
  { value: "contabilidad", label: "Contabilidad" },
  { value: "rrhh", label: "Gestion Humana" },
  { value: "reportes", label: "Reportes" },
];

// --- Plantillas prehechas: puntos de partida para no empezar en blanco. ---
const TEMPLATES: { name: string; desc: string; make: () => DynModuleDef }[] = [
  {
    name: "Clientes",
    desc: "Directorio de clientes con contacto y estado.",
    make: () => ({
      id: "clientes",
      name: "Clientes",
      description: "Directorio de clientes.",
      icon: "users",
      color: "#3b6fb0",
      dataScope: "company",
      category: "ventas",
      minLevel: 1,
      writeLevel: 2,
      fields: [
        { key: "nombre", label: "Nombre", type: "text", required: true, inList: true },
        { key: "telefono", label: "Telefono", type: "text", inList: true },
        { key: "email", label: "Correo", type: "text", inList: true },
        { key: "direccion", label: "Direccion", type: "textarea" },
        { key: "activo", label: "Activo", type: "boolean", inList: true },
      ],
    }),
  },
  {
    name: "Productos",
    desc: "Catalogo de productos con precio y stock.",
    make: () => ({
      id: "productos",
      name: "Productos",
      description: "Catalogo de productos.",
      icon: "boxes",
      color: "#9a7b3f",
      dataScope: "shared",
      category: "inventario",
      minLevel: 1,
      writeLevel: 2,
      fields: [
        { key: "codigo", label: "Codigo", type: "text", required: true, inList: true },
        { key: "nombre", label: "Nombre", type: "text", required: true, inList: true },
        { key: "precio", label: "Precio", type: "money", inList: true },
        { key: "stock", label: "Stock", type: "number", inList: true },
        {
          key: "categoria",
          label: "Categoria",
          type: "select",
          options: ["General", "Ofertas", "Descontinuado"],
          inList: true,
        },
      ],
    }),
  },
  {
    name: "Tareas",
    desc: "Lista de tareas con responsable y estado.",
    make: () => ({
      id: "tareas",
      name: "Tareas",
      description: "Seguimiento de tareas.",
      icon: "bar-chart",
      color: "#3f7d8c",
      dataScope: "company",
      category: "reportes",
      minLevel: 1,
      writeLevel: 1,
      fields: [
        { key: "titulo", label: "Titulo", type: "text", required: true, inList: true },
        { key: "responsable", label: "Responsable", type: "text", inList: true },
        { key: "vence", label: "Vence", type: "date", inList: true },
        {
          key: "estado",
          label: "Estado",
          type: "select",
          options: ["Pendiente", "En curso", "Hecha"],
          inList: true,
        },
        { key: "notas", label: "Notas", type: "textarea" },
      ],
    }),
  },
  {
    name: "Gastos",
    desc: "Registro de gastos con monto y fecha.",
    make: () => ({
      id: "gastos",
      name: "Gastos",
      description: "Control de gastos.",
      icon: "calculator",
      color: "#6a5c9a",
      dataScope: "company",
      category: "contabilidad",
      minLevel: 1,
      writeLevel: 2,
      fields: [
        { key: "concepto", label: "Concepto", type: "text", required: true, inList: true },
        { key: "monto", label: "Monto", type: "money", required: true, inList: true },
        { key: "fecha", label: "Fecha", type: "date", required: true, inList: true },
        {
          key: "categoria",
          label: "Categoria",
          type: "select",
          options: ["Oficina", "Transporte", "Servicios", "Otros"],
          inList: true,
        },
      ],
    }),
  },
];

function emptyDef(): DynModuleDef {
  return {
    id: "",
    name: "",
    description: "",
    icon: "boxes",
    color: "#3f7d8c",
    dataScope: "shared",
    category: "inventario",
    minLevel: 1,
    writeLevel: 2,
    fields: [
      { key: "nombre", label: "Nombre", type: "text", required: true, inList: true },
    ],
  };
}

/** Entrada del catalogo unificado (dinamicos + compilados editables). */
interface AllMod {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  kind: "dynamic" | "builtin" | "other";
  editableFiles: boolean;
}

export function Estudio({ module }: { module: ModuleManifest }) {
  const { user, refreshSession } = useAuth();
  const isAdmin =
    user?.globalRole === "superadmin" || user?.globalRole === "admin";

  const [view, setView] = useState<View>("lista");
  const [list, setList] = useState<DynModuleDef[]>([]);
  const [allMods, setAllMods] = useState<AllMod[]>([]);
  const [draft, setDraft] = useState<DynModuleDef>(emptyDef());
  const [isNew, setIsNew] = useState(true);
  // Cuando editamos un modulo COMPILADO, solo mostramos su editor de archivos.
  const [builtinEdit, setBuiltinEdit] = useState<AllMod | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const load = useCallback(() => {
    api
      .estudioList()
      .then(setList)
      .catch((e) => setMsg({ tone: "error", text: String(e.message ?? e) }));
    api
      .estudioAll()
      .then(setAllMods)
      .catch(() => {});
  }, []);

  useEffect(() => load(), [load]);

  function editBuiltin(m: AllMod) {
    setBuiltinEdit(m);
    setMsg(null);
    setView("editor");
  }

  function newModule() {
    setBuiltinEdit(null);
    setDraft(emptyDef());
    setIsNew(true);
    setMsg(null);
    setView("editor");
  }

  function fromTemplate(make: () => DynModuleDef) {
    setBuiltinEdit(null);
    setDraft(make());
    setIsNew(true);
    setMsg(null);
    setView("editor");
  }

  function edit(def: DynModuleDef) {
    setBuiltinEdit(null);
    setDraft(JSON.parse(JSON.stringify(def)));
    setIsNew(false);
    setMsg(null);
    setView("editor");
  }

  async function remove(def: DynModuleDef) {
    if (
      !confirm(
        `¿Eliminar el modulo "${def.name}"?\n\nSe borraran tambien TODOS sus datos. Esta accion no se puede deshacer.`,
      )
    )
      return;
    try {
      await api.estudioDelete(def.id, true);
      setMsg({ tone: "success", text: `Modulo "${def.name}" eliminado.` });
      load();
      await refreshSession();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      if (isNew) await api.estudioCreate(draft);
      else await api.estudioUpdate(draft.id, draft);
      setMsg({ tone: "success", text: "Modulo guardado. Ya aparece en el escritorio." });
      load();
      await refreshSession();
      setView("lista");
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleShell moduleId="estudio">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Estudio de modulos"
        subtitle="Crea tus propios modulos sin programar"
      />

      <Toolbar>
        <Button
          variant={view === "lista" ? "primary" : "default"}
          onClick={() => setView("lista")}
        >
          Mis modulos
        </Button>
        <Button
          variant={view === "ayuda" ? "primary" : "default"}
          onClick={() => setView("ayuda")}
        >
          Ayuda
        </Button>
        <Spacer />
        {isAdmin && view !== "editor" && (
          <Button variant="primary" onClick={newModule}>
            <Icon name="plus" size={14} /> Nuevo modulo
          </Button>
        )}
      </Toolbar>

      <ModuleBody>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {!isAdmin && (
          <Notice>Solo un administrador puede crear o editar modulos.</Notice>
        )}

        {view === "lista" && (
          <ListView
            list={list}
            allMods={allMods}
            isAdmin={isAdmin}
            onEdit={edit}
            onEditBuiltin={editBuiltin}
            onRemove={remove}
            onTemplate={fromTemplate}
          />
        )}

        {view === "ayuda" && <HelpView />}

        {/* Editar un modulo COMPILADO: solo su editor de archivos fuente. */}
        {view === "editor" && builtinEdit && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Button variant="ghost" onClick={() => setView("lista")}>
                ← Volver
              </Button>
              <h3 style={{ margin: 0 }}>Codigo: {builtinEdit.name}</h3>
            </div>
            <FileManager moduleId={builtinEdit.id} builtin />
          </div>
        )}

        {view === "editor" && !builtinEdit && (
          <Editor
            draft={draft}
            setDraft={setDraft}
            isNew={isNew}
            disabled={!isAdmin}
            saving={saving}
            onSave={save}
            onCancel={() => setView("lista")}
            showCode={showCode}
            setShowCode={setShowCode}
          />
        )}
      </ModuleBody>
    </ModuleShell>
  );
}

// ================= Lista de modulos =================
function ListView({
  list,
  allMods,
  isAdmin,
  onEdit,
  onEditBuiltin,
  onRemove,
  onTemplate,
}: {
  list: DynModuleDef[];
  allMods: AllMod[];
  isAdmin: boolean;
  onEdit: (d: DynModuleDef) => void;
  onEditBuiltin: (m: AllMod) => void;
  onRemove: (d: DynModuleDef) => void;
  onTemplate: (make: () => DynModuleDef) => void;
}) {
  // Modulos compilados editables que NO son dinamicos (inventario, articulos).
  const builtins = allMods.filter((m) => m.kind === "builtin");
  return (
    <>
      <h3 style={h3}>Mis modulos (creados aqui)</h3>
      {list.length === 0 ? (
        <Notice>
          Aun no has creado modulos. Empieza con una <b>plantilla</b> de abajo o
          pulsa <b>Nuevo modulo</b>.
        </Notice>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {list.map((d) => (
            <div key={d.id} className="wtm-estudio-card">
              <span
                className="wtm-estudio-card__icon"
                style={{ background: d.color }}
              >
                <Icon name={d.icon} size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
                  {d.fields.length} campo(s) ·{" "}
                  {d.dataScope === "company" ? "por empresa" : "compartido"} ·{" "}
                  id: {d.id}
                </div>
              </div>
              {isAdmin && (
                <>
                  <Button variant="default" onClick={() => onEdit(d)}>
                    <Icon name="edit" size={13} /> Editar
                  </Button>
                  <Button variant="ghost" onClick={() => onRemove(d)}>
                    <Icon name="trash" size={13} />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modulos del sistema con codigo (editables por archivos, requieren
          recompilar). Permite tocar inventario/articulos como en WordPress. */}
      {isAdmin && builtins.length > 0 && (
        <>
          <h3 style={h3}>Modulos con codigo (avanzado)</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
            {builtins.map((m) => (
              <div key={m.id} className="wtm-estudio-card">
                <span className="wtm-estudio-card__icon" style={{ background: m.color }}>
                  <Icon name={m.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
                    Modulo del sistema · codigo TypeScript · id: {m.id}
                  </div>
                </div>
                <Button variant="default" onClick={() => onEditBuiltin(m)}>
                  <Icon name="code" size={13} /> Editar codigo
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {isAdmin && (
        <>
          <h3 style={h3}>Plantillas para empezar rapido</h3>
          <div className="wtm-estudio-templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                className="wtm-estudio-template"
                onClick={() => onTemplate(t.make)}
              >
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
                  {t.desc}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ================= Editor de modulo =================
function Editor({
  draft,
  setDraft,
  isNew,
  disabled,
  saving,
  onSave,
  onCancel,
  showCode,
  setShowCode,
}: {
  draft: DynModuleDef;
  setDraft: (d: DynModuleDef) => void;
  isNew: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  showCode: boolean;
  setShowCode: (v: boolean) => void;
}) {
  const [editorTab, setEditorTab] = useState<"diseno" | "vista" | "archivos">(
    "diseno",
  );
  function set<K extends keyof DynModuleDef>(key: K, value: DynModuleDef[K]) {
    setDraft({ ...draft, [key]: value });
  }

  // Autogenerar el id a partir del nombre (solo al crear y si no se ha tocado).
  function onName(name: string) {
    const next: DynModuleDef = { ...draft, name };
    if (isNew) next.id = slug(name);
    setDraft(next);
  }

  function addField() {
    set("fields", [
      ...draft.fields,
      { key: `campo${draft.fields.length + 1}`, label: "", type: "text", inList: true },
    ]);
  }
  function updateField(i: number, patch: Partial<DynField>) {
    set(
      "fields",
      draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  }
  function removeField(i: number) {
    set("fields", draft.fields.filter((_, j) => j !== i));
  }
  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= draft.fields.length) return;
    const arr = [...draft.fields];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("fields", arr);
  }

  // El modulo ya existe en disco si no es nuevo: ahi puede editar archivos.
  const canEditFiles = !isNew;

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Button variant="ghost" onClick={onCancel}>
          ← Volver
        </Button>
        <h3 style={{ margin: 0 }}>
          {isNew ? "Nuevo modulo" : `Editar: ${draft.name}`}
        </h3>
        <div style={{ flex: 1 }} />
        <div className="wtm-subtabs">
          <button
            className={`wtm-subtab ${editorTab === "diseno" ? "is-active" : ""}`}
            onClick={() => setEditorTab("diseno")}
          >
            Diseno
          </button>
          <button
            className={`wtm-subtab ${editorTab === "vista" ? "is-active" : ""}`}
            onClick={() => setEditorTab("vista")}
            disabled={!canEditFiles}
            title={canEditFiles ? "" : "Guarda el modulo primero"}
          >
            Vista
          </button>
          <button
            className={`wtm-subtab ${editorTab === "archivos" ? "is-active" : ""}`}
            onClick={() => setEditorTab("archivos")}
            disabled={!canEditFiles}
            title={canEditFiles ? "" : "Guarda el modulo primero para editar sus archivos"}
          >
            Archivos (codigo)
          </button>
        </div>
      </div>

      {editorTab === "archivos" && canEditFiles ? (
        <FileManager moduleId={draft.id} />
      ) : editorTab === "vista" && canEditFiles ? (
        <ViewEditor moduleId={draft.id} fields={draft.fields} />
      ) : (
        renderDesign()
      )}
    </div>
  );

  // El cuerpo del disenador visual como VARIABLE (no como componente anidado:
  // eso remontaba el formulario en cada tecla y perdia el foco).
  function renderDesign() {
    return (
    <>
      <h3 style={h3}>1. Datos del modulo</h3>
      <div style={grid2}>
        <Field label="Nombre">
          <Input
            value={draft.name}
            disabled={disabled}
            onChange={(e) => onName(e.target.value)}
            placeholder="Ej: Clientes"
          />
        </Field>
        <Field label="Identificador (no cambiar luego)">
          <Input
            value={draft.id}
            disabled={disabled || !isNew}
            onChange={(e) => set("id", slug(e.target.value))}
            placeholder="clientes"
          />
        </Field>
      </div>
      <Field label="Descripcion">
        <Input
          value={draft.description}
          disabled={disabled}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Para que sirve este modulo"
        />
      </Field>

      <div style={grid2}>
        <Field label="Icono">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ICON_CHOICES.map((ic) => (
              <button
                key={ic}
                type="button"
                disabled={disabled}
                onClick={() => set("icon", ic)}
                className="wtm-estudio-icon"
                style={{
                  borderColor: draft.icon === ic ? "var(--wtm-accent)" : "var(--wtm-border)",
                  background: draft.icon === ic ? draft.color : "var(--wtm-surface)",
                  color: draft.icon === ic ? "#fff" : "var(--wtm-text)",
                }}
              >
                <Icon name={ic} size={16} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={draft.color}
            disabled={disabled}
            onChange={(e) => set("color", e.target.value)}
            style={{ width: 60, height: 34, border: "none", background: "none" }}
          />
        </Field>
      </div>

      <div style={grid2}>
        <Field label="Categoria (menu del escritorio)">
          <Select
            value={draft.category}
            disabled={disabled}
            onChange={(e) => set("category", e.target.value as DynModuleDef["category"])}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Alcance de los datos">
          <Select
            value={draft.dataScope}
            disabled={disabled}
            onChange={(e) =>
              set("dataScope", e.target.value as DynModuleDef["dataScope"])
            }
          >
            <option value="shared">Compartido entre empresas</option>
            <option value="company">Separado por empresa</option>
          </Select>
        </Field>
      </div>

      <h3 style={h3}>2. Campos de datos</h3>
      <Notice>
        Cada campo es una columna. Marca <b>En lista</b> para que aparezca en la
        tabla, y <b>Obligatorio</b> si no puede quedar vacio.
      </Notice>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {draft.fields.map((f, i) => (
          <FieldRow
            key={i}
            field={f}
            disabled={disabled}
            onChange={(patch) => updateField(i, patch)}
            onRemove={() => removeField(i)}
            onUp={() => moveField(i, -1)}
            onDown={() => moveField(i, 1)}
          />
        ))}
      </div>
      {!disabled && (
        <Button variant="default" onClick={addField} style={{ marginTop: 10 }}>
          <Icon name="plus" size={13} /> Agregar campo
        </Button>
      )}

      <h3 style={h3}>3. Permisos</h3>
      <div style={grid2}>
        <Field label="Nivel minimo para ver (1-10)">
          <Input
            type="number"
            min={1}
            max={10}
            value={String(draft.minLevel)}
            disabled={disabled}
            onChange={(e) => set("minLevel", clamp(e.target.value))}
          />
        </Field>
        <Field label="Nivel minimo para crear/editar (1-10)">
          <Input
            type="number"
            min={1}
            max={10}
            value={String(draft.writeLevel)}
            disabled={disabled}
            onChange={(e) => set("writeLevel", clamp(e.target.value))}
          />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          className="ui-btn ui-btn--ghost"
          onClick={() => setShowCode(!showCode)}
        >
          <Icon name="code" size={13} /> {showCode ? "Ocultar" : "Ver"} definicion (avanzado)
        </button>
        {showCode && (
          <pre className="wtm-estudio-code">
            {JSON.stringify(draft, null, 2)}
          </pre>
        )}
      </div>

      {!disabled && (
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            <Icon name="save" size={14} /> {saving ? "Guardando..." : "Guardar modulo"}
          </Button>
          <Button variant="default" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </>
    );
  }
}

function FieldRow({
  field,
  disabled,
  onChange,
  onRemove,
  onUp,
  onDown,
}: {
  field: DynField;
  disabled: boolean;
  onChange: (patch: Partial<DynField>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="wtm-estudio-field">
      <Input
        value={field.label}
        disabled={disabled}
        placeholder="Etiqueta (ej: Nombre)"
        onChange={(e) => onChange({ label: e.target.value })}
        style={{ flex: 1, minWidth: 120 }}
      />
      <Select
        value={field.type}
        disabled={disabled}
        onChange={(e) => onChange({ type: e.target.value as DynFieldType })}
        style={{ width: 150 }}
      >
        {FIELD_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      {field.type === "select" && (
        <Input
          value={(field.options ?? []).join(", ")}
          disabled={disabled}
          placeholder="Opcion1, Opcion2, ..."
          onChange={(e) =>
            onChange({
              options: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          style={{ flex: 1, minWidth: 140 }}
        />
      )}
      <label style={chk} title="Mostrar en la tabla">
        <input
          type="checkbox"
          checked={field.inList !== false}
          disabled={disabled}
          onChange={(e) => onChange({ inList: e.target.checked })}
        />
        Lista
      </label>
      <label style={chk} title="Campo obligatorio">
        <input
          type="checkbox"
          checked={!!field.required}
          disabled={disabled}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Oblig.
      </label>
      {!disabled && (
        <div style={{ display: "flex", gap: 2 }}>
          <button className="ui-btn ui-btn--ghost" style={mini} onClick={onUp} title="Subir">▲</button>
          <button className="ui-btn ui-btn--ghost" style={mini} onClick={onDown} title="Bajar">▼</button>
          <button className="ui-btn ui-btn--ghost" style={mini} onClick={onRemove} title="Quitar">
            <Icon name="trash" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ================= Ayuda =================
function HelpView() {
  return (
    <div style={{ maxWidth: 680, lineHeight: 1.6 }}>
      <h3 style={h3}>¿Que es un modulo?</h3>
      <p>
        Un modulo es una mini-aplicacion dentro de WTM para guardar y gestionar
        un tipo de informacion: clientes, productos, tareas, gastos... Tu
        defines <b>que datos</b> guarda (los campos) y WTM crea automaticamente
        la tabla, el buscador y los formularios.
      </p>

      <h3 style={h3}>Pasos para crear uno</h3>
      <ol style={{ paddingLeft: 20 }}>
        <li>Pulsa <b>Nuevo modulo</b> o elige una <b>plantilla</b>.</li>
        <li>Ponle un <b>nombre</b> (el identificador se genera solo).</li>
        <li>Agrega los <b>campos</b> que necesites y elige su tipo.</li>
        <li>Guarda. El modulo aparece en el escritorio al instante.</li>
      </ol>

      <h3 style={h3}>Tipos de campo</h3>
      <ul style={{ paddingLeft: 20 }}>
        {FIELD_TYPES.map((t) => (
          <li key={t.value}>
            <b>{t.label}:</b> {t.hint}
          </li>
        ))}
      </ul>

      <h3 style={h3}>Alcance de los datos</h3>
      <p>
        <b>Compartido</b>: todas las empresas ven los mismos registros (ej: un
        catalogo de productos comun). <b>Separado por empresa</b>: cada empresa
        tiene sus propios registros (ej: los clientes de cada una).
      </p>

      <h3 style={h3}>Permisos</h3>
      <p>
        El <b>nivel para ver</b> y el <b>nivel para crear/editar</b> (1 a 10) se
        combinan con los permisos de cada usuario en Ajustes → Usuarios. Un
        usuario necesita al menos ese nivel en el modulo para usarlo.
      </p>

      <h3 style={h3}>Logica avanzada (archivo logic.js)</h3>
      <p>
        En la pestana <b>Archivos</b>, el archivo <code>logic.js</code> permite
        anadir comportamiento con codigo. Defines "hooks" que reciben{" "}
        <code>(record, ctx, wtm)</code>:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li><b>validate</b>: rechazar datos invalidos antes de guardar.</li>
        <li><b>beforeSave</b>: transformar el registro antes de guardarlo.</li>
        <li><b>afterSave</b>: reaccionar despues de guardar.</li>
        <li><b>compute</b>: agregar campos calculados al listar.</li>
      </ul>
      <p>
        El objeto <code>wtm</code> te da acceso REAL a la base de datos:{" "}
        <code>wtm.data.list/count/sum</code> para este modulo y{" "}
        <code>wtm.related.list('otroModulo')</code> para conectar con otros
        modulos. Pulsa el boton <b>API</b> en el editor para ver la referencia.
      </p>

      <h3 style={h3}>Modulos con codigo (avanzado)</h3>
      <p>
        Los modulos del sistema (Inventario, Articulos) se pueden editar en su
        codigo fuente TypeScript. Tienen todo el poder del servidor (base de
        datos directa, archivos, dependencias npm), pero al guardarlos hay que{" "}
        <b>Recompilar</b> para aplicar los cambios.
      </p>

      <Notice>
        Seguridad: <code>logic.js</code> corre en un entorno aislado (sin acceso
        a archivos del sistema ni a la red) para proteger el servidor. Si
        necesitas esas capacidades, usa un modulo con codigo (TypeScript).
      </Notice>
      <Notice>
        Consejo: empieza simple con 3-4 campos. Siempre puedes agregar mas
        campos despues; los datos ya guardados se conservan.
      </Notice>
    </div>
  );
}

// --- helpers ---
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 31);
}
function clamp(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.round(n)));
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
const chk: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  color: "var(--wtm-text-dim)",
  whiteSpace: "nowrap",
};
const mini: React.CSSProperties = { padding: "2px 7px" };
