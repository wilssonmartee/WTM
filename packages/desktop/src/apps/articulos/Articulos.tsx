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
import { ENCODINGS, normalizeText, type DbfTable } from "./dbf";
import type { WorkerResponse } from "./dbf.worker";
import { DataGrid } from "./DataGrid";
import {
  clearFileBytes,
  gunzip,
  gzip,
  loadFileBytes,
  saveFileBytes,
} from "./fileStore";

interface ColumnConfig {
  name: string;
  alias: string;
  visible: boolean;
  order: number;
}
interface SavedConfig {
  columns: ColumnConfig[];
  sortBy: string | null;
  sortDir: "asc" | "desc";
  encoding: string;
  fileLabel: string; // etiqueta del archivo (nombre), informativa
}

type View = "datos" | "config";

export function Articulos({ module }: { module: ModuleManifest }) {
  const { levelFor } = useAuth();
  const canConfig = levelFor("articulos") >= 2;

  const [view, setView] = useState<View>("datos");
  const [table, setTable] = useState<DbfTable | null>(null);
  const [searchIndex, setSearchIndex] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [encoding, setEncoding] = useState("auto");
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const savedConfigRef = useRef<SavedConfig | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);

  // Worker de parseo.
  useEffect(() => {
    const worker = new Worker(new URL("./dbf.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const buildColumns = useCallback(
    (fields: { name: string }[], saved: SavedConfig | null): ColumnConfig[] => {
      const byName = new Map((saved?.columns ?? []).map((c) => [c.name, c]));
      return fields
        .map((f, i) => {
          const s = byName.get(f.name);
          return {
            name: f.name,
            alias: s?.alias ?? f.name,
            visible: s?.visible ?? true,
            order: s?.order ?? i,
          };
        })
        .sort((a, b) => a.order - b.order);
    },
    [],
  );

  // Parsea un ArrayBuffer con el worker.
  const parseBuffer = useCallback(
    (buf: ArrayBuffer, enc: string): Promise<void> =>
      new Promise((resolve) => {
        const worker = workerRef.current;
        if (!worker) return resolve();
        const copy = buf.slice(0);
        const onMsg = (ev: MessageEvent<WorkerResponse>) => {
          worker.removeEventListener("message", onMsg);
          const r = ev.data;
          if (!r.ok || !r.fields || !r.records) {
            setError(r.error ?? "El archivo no parece un DBF valido");
            resolve();
            return;
          }
          setTable({
            fields: r.fields,
            records: r.records,
            recordCount: r.recordCount ?? r.records.length,
            encoding: r.encoding ?? enc,
            detectedEncoding: r.detectedEncoding ?? enc,
          });
          setSearchIndex(r.searchIndex ?? []);
          setColumns(buildColumns(r.fields, savedConfigRef.current));
          if (enc === "auto" && r.encoding) setEncoding(r.encoding);
          resolve();
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ buffer: copy, encoding: enc }, [copy]);
      }),
    [buildColumns],
  );

  // --- Al abrir el modulo: cargar config + el DBF guardado en el core ---
  useEffect(() => {
    (async () => {
      // Config guardada en el core (columnas/alias/orden/encoding/etiqueta).
      const cfg = await api
        .moduleCall<SavedConfig | null>("articulos", "/config")
        .catch(() => null);
      if (cfg) {
        savedConfigRef.current = cfg;
        if (cfg.encoding) setEncoding(cfg.encoding);
        if (cfg.sortBy) setSortBy(cfg.sortBy);
        if (cfg.sortDir) setSortDir(cfg.sortDir);
        if (cfg.fileLabel) setFileLabel(cfg.fileLabel);
      }

      setLoading(true);
      try {
        // 1) Copia local recordada (bytes en IndexedDB) -> carga instantanea.
        const local = await loadFileBytes();
        if (local) {
          setRemembered(true);
          if (!cfg?.fileLabel) setFileLabel(local.name);
          await parseBuffer(local.bytes.slice(0), cfg?.encoding ?? "auto");
          setStatusMsg("Datos cargados (copia local recordada).");
          return;
        }
        // 2) Si no, el DBF guardado en el core.
        const bytes = await api.moduleDownload("articulos", "/data");
        if (bytes) {
          const plain = await gunzip(bytes);
          const ab = plain.buffer.slice(
            plain.byteOffset,
            plain.byteOffset + plain.byteLength,
          ) as ArrayBuffer;
          await parseBuffer(ab, cfg?.encoding ?? "auto");
          setStatusMsg("Datos cargados desde el servidor.");
        }
      } catch {
        /* sin datos aun */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible).sort((a, b) => a.order - b.order),
    [columns],
  );

  useEffect(() => setSelected(new Set()), [query, sortBy, sortDir, table]);

  const rows = useMemo(() => {
    if (!table) return [];
    let data = table.records;
    const q = normalizeText(query);
    if (q && searchIndex.length === data.length) {
      const terms = q.split(" ");
      data = data.filter((_r, i) => terms.every((t) => searchIndex[i].includes(t)));
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
          String(av).localeCompare(String(bv), "es", {
            sensitivity: "base",
            numeric: true,
          }) * dir
        );
      });
    }
    return data;
  }, [table, query, searchIndex, sortBy, sortDir]);

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  // Elegir archivo (abre el selector del sistema). Vale tanto para
  // Configuracion como para "Actualizar": siempre pide el archivo.
  function pickFile() {
    setError("");
    fallbackRef.current?.click();
  }

  // Al elegir un archivo: guardar bytes en IndexedDB (recordar), parsear,
  // subir al core, y guardar la etiqueta en config.
  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    const buf = await file.arrayBuffer();
    setFileLabel(file.name);
    await saveFileBytes(file.name, buf.slice(0)); // recordar contenido
    setRemembered(true);
    await persistConfig({ fileLabel: file.name });
    await refreshWith(buf);
  }

  // "Actualizar": vuelve a pedir el archivo para releer datos frescos.
  function refresh() {
    setError("");
    setStatusMsg("");
    pickFile();
  }

  async function refreshWith(buf: ArrayBuffer) {
    setLoading(true);
    await parseBuffer(buf, encoding);
    setLoading(false);
    setView("datos");
    uploadToCore(buf);
  }

  async function uploadToCore(buf: ArrayBuffer) {
    if (!canConfig) return; // solo nivel 2+ persiste en el servidor
    try {
      setUploadPct(0);
      const compressed = await gzip(new Uint8Array(buf));
      await api.moduleUpload("articulos", "/data", compressed, (f) =>
        setUploadPct(Math.round(f * 100)),
      );
      setUploadPct(100);
      setStatusMsg("Copia guardada en el servidor.");
      setTimeout(() => setUploadPct(null), 1200);
    } catch (e) {
      setUploadPct(null);
      setStatusMsg(
        "No se pudo guardar en el servidor: " +
          (e instanceof Error ? e.message : "error"),
      );
    }
  }

  function changeEncoding(enc: string) {
    setEncoding(enc);
    // re-aplicar sobre los datos ya cargados no es trivial sin el buffer;
    // el usuario puede pulsar Actualizar para releer con la nueva codificacion.
  }

  async function persistConfig(extra: Partial<SavedConfig> = {}) {
    if (!canConfig) return;
    const cfg: SavedConfig = {
      columns,
      sortBy,
      sortDir,
      encoding,
      fileLabel,
      ...extra,
    };
    savedConfigRef.current = cfg;
    await api
      .moduleCall("articulos", "/config", {
        method: "PUT",
        body: JSON.stringify(cfg),
      })
      .catch(() => {});
  }

  async function saveConfigNow() {
    await persistConfig();
    setSavedMsg("Configuracion guardada.");
    setTimeout(() => setSavedMsg(""), 2500);
  }

  async function forgetFile() {
    await clearFileBytes();
    setRemembered(false);
    setFileLabel("");
    await persistConfig({ fileLabel: "" });
  }

  return (
    <ModuleShell moduleId="articulos">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Articulos"
        subtitle="Lee un DBF local: columnas, orden y busqueda"
      />

      <Toolbar>
        <Button
          variant={view === "datos" ? "primary" : "default"}
          onClick={() => setView("datos")}
        >
          Datos
        </Button>
        <Button
          variant={view === "config" ? "primary" : "default"}
          onClick={() => setView("config")}
        >
          Configuracion
        </Button>
        <Spacer />
        {view === "datos" && (
          <Button variant="primary" onClick={refresh} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </Button>
        )}
      </Toolbar>

      {/* Barra de progreso de subida al servidor */}
      {uploadPct !== null && (
        <div className="ui-upload">
          <div className="ui-upload__label">
            Subiendo al servidor... {uploadPct}%
          </div>
          <div className="ui-upload__bar">
            <div
              className="ui-upload__fill"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      <ModuleBody>
        {error && <Notice tone="error">{error}</Notice>}
        {savedMsg && <Notice tone="success">{savedMsg}</Notice>}

        <input
          ref={fallbackRef}
          type="file"
          accept=".dbf,.DBF"
          style={{ display: "none" }}
          onChange={onFilePicked}
        />

        {view === "config" ? (
          <ConfigView
            canConfig={canConfig}
            fileLabel={fileLabel}
            remembered={remembered}
            encoding={encoding}
            onEncoding={changeEncoding}
            onPick={pickFile}
            onForget={forgetFile}
            columns={columns}
            setColumns={setColumns}
            onSave={saveConfigNow}
          />
        ) : (
          <>
            {loading && <Notice>Procesando...</Notice>}
            {statusMsg && !loading && <Notice>{statusMsg}</Notice>}
            {!table && !loading && (
              <Notice>
                No hay datos. Ve a <b>Configuracion</b>, elige tu archivo DBF y
                pulsa <b>Actualizar</b>.
              </Notice>
            )}
            {table && (
              <>
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
                    {fileLabel || "DBF"} ·{" "}
                    {rows.length.toLocaleString()} de{" "}
                    {table.recordCount.toLocaleString()} registros
                    {selected.size > 0
                      ? ` · ${selected.size.toLocaleString()} seleccionado(s)`
                      : ""}
                  </span>
                </div>
                <DataGrid
                  columns={visibleColumns.map((c) => ({
                    name: c.name,
                    alias: c.alias,
                  }))}
                  rows={rows}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  selected={selected}
                  setSelected={setSelected}
                />
              </>
            )}
          </>
        )}
      </ModuleBody>
    </ModuleShell>
  );
}

// ================= Vista de configuracion =================
function ConfigView({
  canConfig,
  fileLabel,
  remembered,
  encoding,
  onEncoding,
  onPick,
  onForget,
  columns,
  setColumns,
  onSave,
}: {
  canConfig: boolean;
  fileLabel: string;
  remembered: boolean;
  encoding: string;
  onEncoding: (e: string) => void;
  onPick: () => void;
  onForget: () => void;
  columns: ColumnConfig[];
  setColumns: (c: ColumnConfig[]) => void;
  onSave: () => void;
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      {!canConfig && (
        <Notice>Necesitas nivel 2+ para configurar este modulo.</Notice>
      )}

      <h3 style={h3}>Archivo DBF</h3>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Button variant="primary" onClick={onPick} disabled={!canConfig}>
          {fileLabel ? "Cambiar archivo..." : "Elegir archivo DBF..."}
        </Button>
        <span style={{ fontSize: 13 }}>
          {fileLabel ? (
            <>
              <b>{fileLabel}</b>{" "}
              {remembered && (
                <span style={{ color: "#2f7d4f" }}>· recordado</span>
              )}
            </>
          ) : (
            <span style={{ color: "var(--wtm-text-dim)" }}>
              Ningun archivo configurado
            </span>
          )}
        </span>
        {fileLabel && (
          <Button variant="ghost" onClick={onForget} disabled={!canConfig}>
            Olvidar
          </Button>
        )}
      </div>
      <Notice>
        El archivo se recuerda (su contenido) en este equipo y se carga solo al
        abrir. Pulsa <b>Actualizar</b> para releer una version mas reciente.
      </Notice>

      <h3 style={h3}>Codificacion</h3>
      <Select
        value={encoding}
        onChange={(e) => onEncoding(e.target.value)}
        style={{ width: 220 }}
        disabled={!canConfig}
      >
        {ENCODINGS.map((en) => (
          <option key={en.id} value={en.id}>
            {en.label}
          </option>
        ))}
      </Select>

      <h3 style={h3}>Columnas (visibilidad, nombre a mostrar, orden)</h3>
      <ColumnEditor columns={columns} setColumns={setColumns} />

      {canConfig && (
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={onSave}>
            Guardar configuracion
          </Button>
        </div>
      )}
    </div>
  );
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
  if (columns.length === 0) {
    return (
      <Notice>Abre un archivo para configurar sus columnas.</Notice>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {ordered.map((c) => (
        <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
  );
}

const h3: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--wtm-text-dim)",
  margin: "20px 0 10px",
};
