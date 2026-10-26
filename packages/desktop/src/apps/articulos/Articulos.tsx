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
import { gunzip } from "./fileStore";

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
}

/** Conexion SMB tal como la devuelve el core (sin contrasena en claro). */
interface SmbConfig {
  host: string;
  share: string;
  username: string;
  domain: string;
  dbfPath: string;
  hasPassword: boolean;
}

type View = "datos" | "config";

const EMPTY_SMB: SmbConfig = {
  host: "",
  share: "",
  username: "",
  domain: "",
  dbfPath: "",
  hasPassword: false,
};

export function Articulos({ module }: { module: ModuleManifest }) {
  const { levelFor } = useAuth();
  const canConfig = levelFor("articulos") >= 2;

  const [view, setView] = useState<View>("datos");
  const [table, setTable] = useState<DbfTable | null>(null);
  const [searchIndex, setSearchIndex] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  // Progreso de "Actualizar": fase legible + porcentaje (null = indeterminado).
  const [progress, setProgress] = useState<{
    phase: string;
    percent: number | null;
    detail: string;
  } | null>(null);
  const [encoding, setEncoding] = useState("auto");
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Conexion SMB.
  const [smb, setSmb] = useState<SmbConfig>(EMPTY_SMB);
  const [smbPassword, setSmbPassword] = useState(""); // solo en memoria al editar
  const [smbTesting, setSmbTesting] = useState(false);
  const [smbTestMsg, setSmbTestMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [smbConfigured, setSmbConfigured] = useState(false);

  const savedConfigRef = useRef<SavedConfig | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Worker de parseo.
  useEffect(() => {
    const worker = new Worker(new URL("./dbf.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Progreso de lectura SMB que emite el core por WebSocket (reenviado por el
  // escritorio como CustomEvent). Solo nos interesa durante "Actualizar".
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        moduleId: string;
        phase: string;
        percent: number | null;
        detail?: string;
      };
      if (d.moduleId !== "articulos") return;
      setProgress({
        phase: d.phase,
        percent: d.percent,
        detail: d.detail ?? "",
      });
    };
    window.addEventListener("wtm:module-progress", handler);
    return () => window.removeEventListener("wtm:module-progress", handler);
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

  // --- Al abrir: cargar config + conexion SMB + la copia cacheada en el core.
  useEffect(() => {
    (async () => {
      const cfg = await api
        .moduleCall<SavedConfig | null>("articulos", "/config")
        .catch(() => null);
      if (cfg) {
        savedConfigRef.current = cfg;
        if (cfg.encoding) setEncoding(cfg.encoding);
        if (cfg.sortBy) setSortBy(cfg.sortBy);
        if (cfg.sortDir) setSortDir(cfg.sortDir);
      }

      const smbCfg = await api
        .moduleCall<SmbConfig | null>("articulos", "/smb/config")
        .catch(() => null);
      if (smbCfg) {
        setSmb(smbCfg);
        setSmbConfigured(!!(smbCfg.host && smbCfg.share && smbCfg.dbfPath));
      }

      // Mostrar de inmediato la ultima copia leida (cache gzip en el core).
      setLoading(true);
      try {
        const bytes = await api.moduleDownload("articulos", "/data");
        if (bytes) {
          const plain = await gunzip(bytes);
          const ab = plain.buffer.slice(
            plain.byteOffset,
            plain.byteOffset + plain.byteLength,
          ) as ArrayBuffer;
          await parseBuffer(ab, cfg?.encoding ?? "auto");
          setStatusMsg("Datos de la ultima lectura. Pulsa Actualizar para releer del servidor SMB.");
        }
      } catch {
        /* sin cache aun */
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

  // "Actualizar": el CORE lee el DBF desde el servidor SMB y nos devuelve los
  // bytes (gzip) para parsear en el navegador.
  async function refresh() {
    setError("");
    setStatusMsg("");
    if (!smbConfigured) {
      setView("config");
      setError(
        "Configura primero la conexion SMB y la ruta del DBF en Configuracion.",
      );
      return;
    }
    setLoading(true);
    setProgress({
      phase: "leyendo",
      percent: 0,
      detail: "Conectando al servidor...",
    });
    try {
      // 1) El core lee del SMB (el progreso real llega por WebSocket) y nos
      //    envia el gzip. La descarga en si es pequena (va comprimida).
      const bytes = await api.moduleDownloadProgress(
        "articulos",
        "/smb/read",
        (frac) => {
          // Fase de transferencia al navegador (tras leer del SMB).
          setProgress({
            phase: "descargando",
            percent: Math.round(frac * 100),
            detail: "Recibiendo datos...",
          });
        },
      );
      // 2) Descomprimir.
      setProgress({
        phase: "descomprimiendo",
        percent: null,
        detail: "Descomprimiendo...",
      });
      const plain = await gunzip(bytes);
      const ab = plain.buffer.slice(
        plain.byteOffset,
        plain.byteOffset + plain.byteLength,
      ) as ArrayBuffer;
      // 3) Parsear en el worker.
      setProgress({
        phase: "procesando",
        percent: null,
        detail: "Procesando registros...",
      });
      await parseBuffer(ab, encoding);
      setView("datos");
      setStatusMsg("Datos actualizados desde el servidor SMB.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el DBF");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function changeEncoding(enc: string) {
    setEncoding(enc);
    // El re-parseo con otra codificacion requiere releer: pulsar Actualizar.
  }

  async function persistConfig(extra: Partial<SavedConfig> = {}) {
    if (!canConfig) return;
    const cfg: SavedConfig = {
      columns,
      sortBy,
      sortDir,
      encoding,
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

  // --- SMB: guardar / probar ---
  async function saveSmb() {
    setSmbTestMsg(null);
    try {
      const payload: Record<string, string> = {
        host: smb.host,
        share: smb.share,
        username: smb.username,
        domain: smb.domain,
        dbfPath: smb.dbfPath,
      };
      // Solo mandamos contrasena si el usuario escribio una nueva.
      if (smbPassword) payload.password = smbPassword;
      const data = await api.moduleCall<SmbConfig>("articulos", "/smb/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSmb(data);
      setSmbPassword("");
      setSmbConfigured(!!(data.host && data.share && data.dbfPath));
      setSavedMsg("Conexion SMB guardada.");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setSmbTestMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al guardar",
      });
    }
  }

  async function testSmb() {
    setSmbTesting(true);
    setSmbTestMsg(null);
    try {
      const payload: Record<string, string> = {
        host: smb.host,
        share: smb.share,
        username: smb.username,
        domain: smb.domain,
        dbfPath: smb.dbfPath,
      };
      if (smbPassword) payload.password = smbPassword;
      const r = await api.moduleCall<{ ok: boolean; detail: string }>(
        "articulos",
        "/smb/test",
        { method: "POST", body: JSON.stringify(payload) },
      );
      setSmbTestMsg({ ok: r.ok, text: r.detail });
    } catch (e) {
      setSmbTestMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Error al probar",
      });
    } finally {
      setSmbTesting(false);
    }
  }

  return (
    <ModuleShell moduleId="articulos">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Articulos"
        subtitle="Lee un DBF desde un servidor SMB: columnas, orden y busqueda"
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

      {/* Barra de progreso de "Actualizar" (lectura SMB + descarga + parseo) */}
      {progress && (
        <div className="ui-upload">
          <div className="ui-upload__label">
            <span className="ui-upload__phase">
              {progressLabel(progress.phase)}
            </span>
            {progress.detail && (
              <span className="ui-upload__detail">— {progress.detail}</span>
            )}
            {progress.percent !== null && (
              <span className="ui-upload__pct">{progress.percent}%</span>
            )}
          </div>
          <div className="ui-upload__bar">
            <div
              className={
                progress.percent === null
                  ? "ui-upload__fill ui-upload__fill--indeterminate"
                  : "ui-upload__fill"
              }
              style={
                progress.percent === null
                  ? undefined
                  : { width: `${Math.max(progress.percent, 3)}%` }
              }
            />
          </div>
        </div>
      )}

      <ModuleBody>
        {error && <Notice tone="error">{error}</Notice>}
        {savedMsg && <Notice tone="success">{savedMsg}</Notice>}

        {view === "config" ? (
          <ConfigView
            canConfig={canConfig}
            smb={smb}
            setSmb={setSmb}
            smbPassword={smbPassword}
            setSmbPassword={setSmbPassword}
            onSaveSmb={saveSmb}
            onTestSmb={testSmb}
            smbTesting={smbTesting}
            smbTestMsg={smbTestMsg}
            encoding={encoding}
            onEncoding={changeEncoding}
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
                No hay datos. Ve a <b>Configuracion</b>, define la conexion SMB y
                la ruta del DBF, luego pulsa <b>Actualizar</b>.
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
                    {smb.dbfPath || "DBF"} ·{" "}
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
  smb,
  setSmb,
  smbPassword,
  setSmbPassword,
  onSaveSmb,
  onTestSmb,
  smbTesting,
  smbTestMsg,
  encoding,
  onEncoding,
  columns,
  setColumns,
  onSave,
}: {
  canConfig: boolean;
  smb: SmbConfig;
  setSmb: (s: SmbConfig) => void;
  smbPassword: string;
  setSmbPassword: (p: string) => void;
  onSaveSmb: () => void;
  onTestSmb: () => void;
  smbTesting: boolean;
  smbTestMsg: { ok: boolean; text: string } | null;
  encoding: string;
  onEncoding: (e: string) => void;
  columns: ColumnConfig[];
  setColumns: (c: ColumnConfig[]) => void;
  onSave: () => void;
}) {
  function set<K extends keyof SmbConfig>(key: K, value: SmbConfig[K]) {
    setSmb({ ...smb, [key]: value });
  }
  return (
    <div style={{ maxWidth: 640 }}>
      {!canConfig && (
        <Notice>Necesitas nivel 2+ para configurar este modulo.</Notice>
      )}

      <h3 style={h3}>Conexion al servidor SMB (Samba)</h3>
      <Notice>
        El nucleo se conecta a tu servidor Samba y lee el DBF directamente. No
        hace falta tener el archivo en el equipo del cliente.
      </Notice>

      <div style={grid2}>
        <Field label="Host / IP">
          <Input
            placeholder="192.168.1.10"
            value={smb.host}
            onChange={(e) => set("host", e.target.value)}
            disabled={!canConfig}
          />
        </Field>
        <Field label="Recurso compartido">
          <Input
            placeholder="datos"
            value={smb.share}
            onChange={(e) => set("share", e.target.value)}
            disabled={!canConfig}
          />
        </Field>
        <Field label="Usuario">
          <Input
            placeholder="usuario"
            value={smb.username}
            onChange={(e) => set("username", e.target.value)}
            disabled={!canConfig}
          />
        </Field>
        <Field label="Contrasena">
          <Input
            type="password"
            placeholder={smb.hasPassword ? "•••••• (guardada)" : "contrasena"}
            value={smbPassword}
            onChange={(e) => setSmbPassword(e.target.value)}
            disabled={!canConfig}
          />
        </Field>
        <Field label="Dominio (opcional)">
          <Input
            placeholder="WORKGROUP"
            value={smb.domain}
            onChange={(e) => set("domain", e.target.value)}
            disabled={!canConfig}
          />
        </Field>
        <Field label="Ruta del DBF dentro del recurso">
          <Input
            placeholder="carpeta\\articulos.dbf"
            value={smb.dbfPath}
            onChange={(e) => set("dbfPath", e.target.value)}
            disabled={!canConfig}
          />
        </Field>
      </div>

      {smbTestMsg && (
        <div style={{ marginTop: 10 }}>
          <Notice tone={smbTestMsg.ok ? "success" : "error"}>
            {smbTestMsg.text}
          </Notice>
        </div>
      )}

      {canConfig && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Button variant="primary" onClick={onSaveSmb}>
            Guardar conexion
          </Button>
          <Button variant="default" onClick={onTestSmb} disabled={smbTesting}>
            {smbTesting ? "Probando..." : "Probar conexion"}
          </Button>
        </div>
      )}

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>{label}</span>
      {children}
    </label>
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
    return <Notice>Pulsa Actualizar para leer el DBF y configurar sus columnas.</Notice>;
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

/** Texto amigable para cada fase del proceso de actualizar. */
function progressLabel(phase: string): string {
  switch (phase) {
    case "leyendo":
      return "Leyendo del servidor SMB";
    case "comprimiendo":
      return "Comprimiendo en el servidor";
    case "enviando":
    case "descargando":
      return "Descargando al navegador";
    case "descomprimiendo":
      return "Descomprimiendo";
    case "procesando":
      return "Procesando registros";
    default:
      return "Trabajando";
  }
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
  marginTop: 12,
};
