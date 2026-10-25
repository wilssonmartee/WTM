import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModuleManifest } from "@wtm/shared";
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
import { api } from "../../lib/api";
import { useAuth } from "../../state/auth";
import { Icon } from "../../components/Icon";
import { ENCODINGS, normalizeText, parseDbf, type DbfTable } from "./dbf";

interface ColumnConfig {
  name: string; // nombre real del campo DBF
  alias: string; // sobrenombre a mostrar
  visible: boolean;
  order: number; // posicion
}
interface SavedConfig {
  columns: ColumnConfig[];
  sortBy: string | null;
  sortDir: "asc" | "desc";
  encoding: string;
}

export function Articulos({ module }: { module: ModuleManifest }) {
  const { levelFor } = useAuth();
  const canConfig = levelFor("articulos") >= 2; // nivel 2+ puede guardar config
  const [table, setTable] = useState<DbfTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState("auto");
  const [lastBuffer, setLastBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState("");
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const savedConfigRef = useRef<SavedConfig | null>(null);

  // Cargar config global guardada (columnas/alias/orden/encoding).
  useEffect(() => {
    api
      .moduleCall<SavedConfig | null>("articulos", "/config")
      .then((cfg) => {
        if (cfg) {
          savedConfigRef.current = cfg;
          if (cfg.encoding) setEncoding(cfg.encoding);
          if (cfg.sortBy) setSortBy(cfg.sortBy);
          if (cfg.sortDir) setSortDir(cfg.sortDir);
        }
      })
      .catch(() => {});
  }, []);

  /** Aplica una config guardada sobre los campos recien leidos. */
  const buildColumns = useCallback(
    (fields: { name: string }[], saved: SavedConfig | null): ColumnConfig[] => {
      const savedByName = new Map(
        (saved?.columns ?? []).map((c) => [c.name, c]),
      );
      const cols = fields.map((f, i) => {
        const s = savedByName.get(f.name);
        return {
          name: f.name,
          alias: s?.alias ?? f.name,
          visible: s?.visible ?? true,
          order: s?.order ?? i,
        };
      });
      return cols.sort((a, b) => a.order - b.order);
    },
    [],
  );

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const buf = await file.arrayBuffer();
      setLastBuffer(buf);
      setFileName(file.name);
      parseInto(buf, encoding);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo");
    }
  }

  function parseInto(buf: ArrayBuffer, enc: string) {
    try {
      const t = parseDbf(buf, enc);
      setTable(t);
      setColumns(buildColumns(t.fields, savedConfigRef.current));
      if (enc === "auto") setEncoding(t.encoding);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "El archivo no parece un DBF valido",
      );
      setTable(null);
    }
  }

  // Re-parsear al cambiar la codificacion (sin volver a elegir archivo).
  function changeEncoding(enc: string) {
    setEncoding(enc);
    if (lastBuffer) parseInto(lastBuffer, enc);
  }

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible).sort((a, b) => a.order - b.order),
    [columns],
  );

  // Filtrado (busqueda normalizada) + orden.
  const rows = useMemo(() => {
    if (!table) return [];
    let data = table.records;
    const q = normalizeText(query);
    if (q) {
      const terms = q.split(" ");
      data = data.filter((row) => {
        const hay = normalizeText(
          visibleColumns.map((c) => row[c.name]).join(" "),
        );
        return terms.every((t) => hay.includes(t));
      });
    }
    if (sortBy) {
      const dir = sortDir === "asc" ? 1 : -1;
      data = [...data].sort((a, b) => {
        const av = a[sortBy];
        const bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return -dir;
        if (bv == null) return dir;
        if (typeof av === "number" && typeof bv === "number")
          return (av - bv) * dir;
        return (
          normalizeText(av).localeCompare(normalizeText(bv)) * dir
        );
      });
    }
    return data;
  }, [table, query, visibleColumns, sortBy, sortDir]);

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  async function saveConfig() {
    const cfg: SavedConfig = { columns, sortBy, sortDir, encoding };
    try {
      await api.moduleCall("articulos", "/config", {
        method: "PUT",
        body: JSON.stringify(cfg),
      });
      savedConfigRef.current = cfg;
      setSavedMsg("Configuracion guardada.");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setSavedMsg(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  // Límite de filas renderizadas para no colgar el DOM con miles de registros.
  const RENDER_CAP = 500;
  const shown = rows.slice(0, RENDER_CAP);

  return (
    <ModuleShell moduleId="articulos">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Articulos"
        subtitle="Lee un DBF local: elige columnas, ordena y busca"
      />

      <Toolbar>
        <Button variant="primary" onClick={() => fileRef.current?.click()}>
          Abrir DBF...
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".dbf,.DBF"
          style={{ display: "none" }}
          onChange={onPickFile}
        />
        <span style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
          Codificacion
        </span>
        <Select
          value={encoding}
          onChange={(e) => changeEncoding(e.target.value)}
          style={{ width: 190 }}
        >
          {ENCODINGS.map((en) => (
            <option key={en.id} value={en.id}>
              {en.label}
              {en.id === "auto" && table
                ? ` (${table.detectedEncoding})`
                : ""}
            </option>
          ))}
        </Select>
        {table && (
          <Button onClick={() => setShowConfig((s) => !s)}>
            {showConfig ? "Ocultar columnas" : "Columnas"}
          </Button>
        )}
        <Spacer />
        {table && canConfig && (
          <Button onClick={saveConfig}>Guardar config</Button>
        )}
      </Toolbar>

      <ModuleBody>
        {error && <Notice tone="error">{error}</Notice>}
        {savedMsg && <Notice tone="success">{savedMsg}</Notice>}

        {!table && (
          <Notice>
            Pulsa "Abrir DBF..." y elige un archivo .dbf de tu equipo. El archivo
            se procesa localmente en tu navegador; no se sube a ningun servidor.
          </Notice>
        )}

        {table && (
          <>
            {/* Buscador + resumen */}
            <div
              className="ui-row"
              style={{ marginBottom: 12, alignItems: "center" }}
            >
              <Input
                placeholder="Buscar (ignora tildes y enies)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ maxWidth: 360 }}
              />
              <span style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
                {fileName} · {rows.length.toLocaleString()} de{" "}
                {table.recordCount.toLocaleString()} registros
                {rows.length > RENDER_CAP
                  ? ` (mostrando ${RENDER_CAP})`
                  : ""}
              </span>
            </div>

            {/* Panel de configuracion de columnas */}
            {showConfig && (
              <ColumnEditor columns={columns} setColumns={setColumns} />
            )}

            {/* Tabla de datos */}
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    {visibleColumns.map((c) => (
                      <th
                        key={c.name}
                        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                        onClick={() => toggleSort(c.name)}
                        title="Ordenar"
                      >
                        {c.alias}
                        {sortBy === c.name
                          ? sortDir === "asc"
                            ? " ▲"
                            : " ▼"
                          : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => (
                    <tr key={i}>
                      {visibleColumns.map((c) => (
                        <td key={c.name}>{formatCell(row[c.name])}</td>
                      ))}
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td
                        colSpan={Math.max(1, visibleColumns.length)}
                        style={{ textAlign: "center" }}
                      >
                        Sin resultados.
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

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Si" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

/** Editor de columnas: visibilidad, alias y orden (subir/bajar). */
function ColumnEditor({
  columns,
  setColumns,
}: {
  columns: ColumnConfig[];
  setColumns: (c: ColumnConfig[]) => void;
}) {
  const ordered = [...columns].sort((a, b) => a.order - b.order);

  function update(name: string, patch: Partial<ColumnConfig>) {
    setColumns(columns.map((c) => (c.name === name ? { ...c, ...patch } : c)));
  }
  function move(name: string, dir: -1 | 1) {
    const arr = [...columns].sort((a, b) => a.order - b.order);
    const i = arr.findIndex((c) => c.name === name);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i].order, arr[j].order] = [arr[j].order, arr[i].order];
    setColumns([...arr]);
  }

  return (
    <div
      style={{
        border: "1px solid var(--wtm-border)",
        borderRadius: "var(--wtm-radius)",
        padding: 12,
        marginBottom: 14,
        background: "var(--wtm-surface)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--wtm-text-dim)",
          marginBottom: 8,
        }}
      >
        COLUMNAS (visibilidad, nombre a mostrar, orden)
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {ordered.map((c) => (
          <div
            key={c.name}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={c.visible}
              onChange={(e) => update(c.name, { visible: e.target.checked })}
              title="Mostrar"
            />
            <span
              style={{
                width: 120,
                fontSize: 12,
                color: "var(--wtm-text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.name}
            >
              {c.name}
            </span>
            <input
              className="ui-input"
              value={c.alias}
              onChange={(e) => update(c.name, { alias: e.target.value })}
              placeholder="Nombre a mostrar"
              style={{ flex: 1, maxWidth: 240, padding: "4px 8px" }}
            />
            <button
              className="ui-btn ui-btn--ghost"
              style={{ padding: "2px 8px" }}
              onClick={() => move(c.name, -1)}
              title="Subir"
            >
              ▲
            </button>
            <button
              className="ui-btn ui-btn--ghost"
              style={{ padding: "2px 8px" }}
              onClick={() => move(c.name, 1)}
              title="Bajar"
            >
              ▼
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
