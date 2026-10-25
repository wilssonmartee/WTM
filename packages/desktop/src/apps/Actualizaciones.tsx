import { useCallback, useEffect, useState } from "react";
import type { ModuleManifest } from "@wtm/shared";
import type {
  CommitInfo,
  UpdateConfig,
  UpdateLogEntry,
  UpdateStatus,
} from "@wtm/shared";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";

/**
 * Modulo de sistema "Actualizaciones": configurar GitHub, revisar y aplicar
 * commits, auto-actualizar, y revertir manualmente a un commit anterior.
 * Solo visible/usable por superadmin.
 */
export function Actualizaciones({ module }: { module: ModuleManifest }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [history, setHistory] = useState<CommitInfo[]>([]);
  const [log, setLog] = useState<UpdateLogEntry[]>([]);
  const [tab, setTab] = useState<"estado" | "historial" | "registro">(
    "estado",
  );
  const [error, setError] = useState("");

  // Formulario de configuracion.
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [interval, setIntervalMin] = useState(15);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const s = await api.updateStatus();
      setStatus(s);
      applyConfig(s.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);

  function applyConfig(c: UpdateConfig) {
    setRepo(c.repo);
    setBranch(c.branch);
    setAutoUpdate(c.autoUpdate);
    setIntervalMin(c.checkIntervalMin);
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === "historial") api.updateHistory().then(setHistory).catch(() => {});
    if (tab === "registro") api.updateLog().then(setLog).catch(() => {});
  }, [tab, status]);

  async function saveConfig() {
    setError("");
    try {
      await api.setUpdateConfig({
        repo,
        branch,
        autoUpdate,
        checkIntervalMin: Number(interval) || 15,
        ...(token ? { token } : {}),
      });
      setToken("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  }

  async function run(fn: () => Promise<UpdateStatus>) {
    setError("");
    try {
      setStatus(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  const msg = status?.lastMessage;

  return (
    <div className="wtm-module">
      <div className="wtm-module__head">
        <div className="wtm-module__icon" style={{ background: module.color }}>
          <Icon name={module.icon} size={20} />
        </div>
        <div className="wtm-module__title">
          <h2>Actualizaciones</h2>
          <p>Mantener el sistema al dia desde GitHub</p>
        </div>
      </div>

      <div className="wtm-toolbar">
        <button
          className={`wtm-tool ${tab === "estado" ? "wtm-tool--primary" : ""}`}
          onClick={() => setTab("estado")}
        >
          Estado
        </button>
        <button
          className={`wtm-tool ${tab === "historial" ? "wtm-tool--primary" : ""}`}
          onClick={() => setTab("historial")}
        >
          Historial
        </button>
        <button
          className={`wtm-tool ${tab === "registro" ? "wtm-tool--primary" : ""}`}
          onClick={() => setTab("registro")}
        >
          Registro
        </button>
        <div style={{ flex: 1 }} />
        <button className="wtm-tool" onClick={refresh}>
          Refrescar
        </button>
      </div>

      <div className="wtm-module__content">
        {error && <div className="wtm-notice">{error}</div>}
        {msg && (
          <div
            className="wtm-notice"
            style={{
              borderLeftColor:
                msg.level === "error"
                  ? "var(--wtm-danger)"
                  : msg.level === "success"
                    ? "#4ade80"
                    : "var(--wtm-accent)",
            }}
          >
            {msg.text}
          </div>
        )}

        {!status?.isGitRepo && (
          <div className="wtm-notice">
            La carpeta del sistema aun no es un repositorio git. Inicializalo y
            conecta un repositorio de GitHub para habilitar las actualizaciones.
          </div>
        )}

        {tab === "estado" && (
          <>
            <div className="wtm-cards" style={{ marginBottom: 18 }}>
              <div className="wtm-card">
                <div className="wtm-card__value">
                  {status?.currentCommit?.shortHash ?? "—"}
                </div>
                <div className="wtm-card__label">Version actual</div>
              </div>
              <div className="wtm-card">
                <div className="wtm-card__value">{status?.behind ?? 0}</div>
                <div className="wtm-card__label">Actualizaciones nuevas</div>
              </div>
              <div className="wtm-card">
                <div className="wtm-card__value">
                  {status?.config.autoUpdate ? "Si" : "No"}
                </div>
                <div className="wtm-card__label">Auto-actualizar</div>
              </div>
            </div>

            {status?.currentCommit && (
              <div className="wtm-notice" style={{ marginTop: 0 }}>
                {status.currentCommit.message} · {status.currentCommit.author}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
              <button
                className="wtm-tool"
                disabled={status?.busy}
                onClick={() => run(api.updateCheck)}
              >
                Revisar ahora
              </button>
              <button
                className="wtm-tool wtm-tool--primary"
                disabled={status?.busy || (status?.behind ?? 0) === 0}
                onClick={() => run(api.updateApply)}
              >
                {status?.busy ? "Trabajando..." : "Actualizar ahora"}
              </button>
            </div>

            <h3
              style={{
                fontSize: 12,
                color: "var(--wtm-text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "20px 0 10px",
              }}
            >
              Configuracion de GitHub
            </h3>
            <div style={{ display: "grid", gap: 10, maxWidth: 440 }}>
              <div className="wtm-field">
                <label>Repositorio (owner/repo)</label>
                <input
                  className="wtm-input"
                  value={repo}
                  placeholder="miusuario/wtm"
                  onChange={(e) => setRepo(e.target.value)}
                />
              </div>
              <div className="wtm-field">
                <label>Rama</label>
                <input
                  className="wtm-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="wtm-field">
                <label>
                  Token de acceso (opcional, para repos privados)
                </label>
                <input
                  className="wtm-input"
                  type="password"
                  value={token}
                  placeholder={
                    status?.config.hasToken
                      ? "•••••• (guardado)"
                      : "ghp_..."
                  }
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={(e) => setAutoUpdate(e.target.checked)}
                />
                Auto-actualizar cuando haya un commit nuevo
              </label>
              {autoUpdate && (
                <div className="wtm-field">
                  <label>Revisar cada (minutos)</label>
                  <input
                    className="wtm-input"
                    type="number"
                    value={interval}
                    onChange={(e) => setIntervalMin(Number(e.target.value))}
                    style={{ width: 120 }}
                  />
                </div>
              )}
              <div>
                <button
                  className="wtm-tool wtm-tool--primary"
                  onClick={saveConfig}
                >
                  Guardar configuracion
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "historial" && (
          <table className="wtm-table">
            <thead>
              <tr>
                <th>Commit</th>
                <th>Mensaje</th>
                <th>Autor</th>
                <th style={{ textAlign: "right" }}>Accion</th>
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.hash}>
                  <td>
                    {c.shortHash}
                    {c.current && (
                      <span
                        className="wtm-tag wtm-tag--ok"
                        style={{ marginLeft: 6 }}
                      >
                        actual
                      </span>
                    )}
                  </td>
                  <td>{c.message}</td>
                  <td>{c.author}</td>
                  <td style={{ textAlign: "right" }}>
                    {!c.current && (
                      <button
                        className="wtm-tool"
                        style={{ padding: "3px 10px" }}
                        disabled={status?.busy}
                        onClick={() => run(() => api.updateRollback(c.hash))}
                      >
                        Volver aqui
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    Sin historial.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "registro" && (
          <table className="wtm-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Accion</th>
                <th>Resultado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.at).toLocaleString("es")}</td>
                  <td>{e.action}</td>
                  <td>
                    <span
                      className={`wtm-tag ${e.ok ? "wtm-tag--ok" : "wtm-tag--warn"}`}
                    >
                      {e.ok ? "ok" : "fallo"}
                    </span>
                  </td>
                  <td
                    style={{
                      maxWidth: 260,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={e.detail}
                  >
                    {e.detail}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    Sin registros.
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
