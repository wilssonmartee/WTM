import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Notice } from "@wtm/ui";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { CodeEditor, langOf } from "./CodeEditor";

/**
 * Administrador de ARCHIVOS de un modulo (estilo editor de temas de WordPress):
 * lista los archivos, abre cualquiera en el editor de codigo, guarda cambios,
 * crea archivos nuevos y borra los que no sean del nucleo.
 *
 * Funciona para modulos DINAMICOS (archivos editables en caliente) y para
 * modulos COMPILADOS (builtin=true: su fuente .ts, que requiere recompilar).
 */

interface FileItem {
  path: string;
  size: number;
  isDir: boolean;
}

const CORE_FILES = new Set(["manifest.json", "schema.json"]);

export function FileManager({
  moduleId,
  builtin = false,
}: {
  moduleId: string;
  builtin?: boolean;
}) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const openedOnce = useRef(false);

  const dirty = content !== original;

  const openFile = useCallback(
    async (p: string, force = false) => {
      if (!force && dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?"))
        return;
      setMsg(null);
      try {
        const r = await api.estudioReadFile(moduleId, p, builtin);
        setActive(p);
        setContent(r.content);
        setOriginal(r.content);
      } catch (e) {
        setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
      }
    },
    [moduleId, builtin, dirty],
  );

  // Cargar la lista de archivos y abrir el primero util, una sola vez.
  useEffect(() => {
    let alive = true;
    openedOnce.current = false;
    setLoading(true);
    setActive(null);
    setContent("");
    setOriginal("");
    api
      .estudioFiles(moduleId, builtin)
      .then(async (list) => {
        if (!alive) return;
        const only = list.filter((f) => !f.isDir);
        setFiles(only);
        if (only.length && !openedOnce.current) {
          openedOnce.current = true;
          const pref =
            only.find((f) => f.path === "logic.js") ??
            only.find((f) => f.path.endsWith(".ts")) ??
            only.find((f) => f.path === "manifest.json") ??
            only[0];
          try {
            const r = await api.estudioReadFile(moduleId, pref.path, builtin);
            if (!alive) return;
            setActive(pref.path);
            setContent(r.content);
            setOriginal(r.content);
          } catch {
            /* ignore */
          }
        }
      })
      .catch((e) => {
        if (alive)
          setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [moduleId, builtin]);

  async function reloadFiles() {
    try {
      const list = await api.estudioFiles(moduleId, builtin);
      setFiles(list.filter((f) => !f.isDir));
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!active) return;
    if (active.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch (e) {
        setMsg({ tone: "error", text: `JSON invalido: ${(e as Error).message}` });
        return;
      }
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.estudioWriteFile(moduleId, active, content, builtin);
      setOriginal(content);
      if (r.needsRebuild) {
        setMsg({
          tone: "success",
          text: "Guardado. Este modulo requiere RECOMPILAR para aplicar los cambios (boton de abajo).",
        });
      } else {
        setMsg({ tone: "success", text: "Archivo guardado. Los cambios ya estan activos." });
      }
      await reloadFiles();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  async function doRebuild() {
    setRebuilding(true);
    setMsg(null);
    try {
      await api.estudioRebuild();
      setMsg({
        tone: "success",
        text: "Recompilando en segundo plano. Puede tardar ~1 min; recarga luego para ver los cambios.",
      });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setRebuilding(false);
    }
  }

  async function createFile() {
    const name = newName.trim().replace(/^\/+/, "");
    if (!name) return;
    if (files.some((f) => f.path === name)) {
      setMsg({ tone: "error", text: "Ya existe un archivo con ese nombre." });
      return;
    }
    try {
      await api.estudioWriteFile(moduleId, name, "", builtin);
      setNewName("");
      setShowNew(false);
      await reloadFiles();
      await openFile(name, true);
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    }
  }

  async function removeFile(p: string) {
    if (CORE_FILES.has(p)) return;
    if (!confirm(`¿Eliminar "${p}"?`)) return;
    try {
      await api.estudioDeleteFile(moduleId, p);
      if (active === p) {
        setActive(null);
        setContent("");
        setOriginal("");
      }
      await reloadFiles();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    }
  }

  return (
    <div>
      {msg && (
        <div style={{ marginBottom: 8 }}>
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <div className="wtm-filemgr">
        <div className="wtm-filemgr__side">
          <div className="wtm-filemgr__side-head">
            <span>Archivos</span>
            {!builtin && (
              <button
                className="ui-btn ui-btn--ghost"
                style={{ padding: "2px 7px" }}
                title="Nuevo archivo"
                onClick={() => setShowNew((v) => !v)}
              >
                <Icon name="plus" size={13} />
              </button>
            )}
          </div>
          {showNew && (
            <div style={{ padding: "6px 8px", display: "flex", gap: 6 }}>
              <Input
                placeholder="nombre.js"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createFile()}
                style={{ fontSize: 12, padding: "4px 6px" }}
              />
              <button
                className="ui-btn ui-btn--primary"
                style={{ padding: "2px 8px" }}
                onClick={createFile}
              >
                OK
              </button>
            </div>
          )}
          <div className="wtm-filemgr__list">
            {loading && (
              <div style={{ padding: 10, fontSize: 12, color: "var(--wtm-text-dim)" }}>
                Cargando...
              </div>
            )}
            {!loading && files.length === 0 && (
              <div style={{ padding: 10, fontSize: 12, color: "var(--wtm-text-dim)" }}>
                Sin archivos.
              </div>
            )}
            {files.map((f) => (
              <div
                key={f.path}
                className={`wtm-filemgr__file ${active === f.path ? "is-active" : ""}`}
                onClick={() => openFile(f.path)}
              >
                <Icon name="code" size={12} />
                <span className="wtm-filemgr__name">{f.path}</span>
                {!builtin && !CORE_FILES.has(f.path) && (
                  <button
                    className="wtm-filemgr__del"
                    title="Eliminar"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(f.path);
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="wtm-filemgr__main">
          {active ? (
            <>
              <div className="wtm-filemgr__bar">
                <span className="wtm-filemgr__active">
                  <Icon name="code" size={13} /> {active}
                  {dirty && (
                    <span style={{ color: "var(--wtm-accent)" }} title="Cambios sin guardar">
                      {" "}
                      ●
                    </span>
                  )}
                </span>
                <span className="wtm-filemgr__lang">{langOf(active)}</span>
                <div style={{ flex: 1 }} />
                {active.endsWith(".json") && (
                  <Button
                    variant="default"
                    onClick={() => {
                      try {
                        setContent(JSON.stringify(JSON.parse(content), null, 2));
                        setMsg({ tone: "success", text: "JSON formateado." });
                      } catch {
                        setMsg({ tone: "error", text: "El JSON tiene errores; no se puede formatear." });
                      }
                    }}
                    title="Ordenar el JSON con sangria"
                  >
                    Formatear
                  </Button>
                )}
                {active === "logic.js" && (
                  <Button
                    variant="default"
                    onClick={() => setShowApi((v) => !v)}
                    title="Ver la API disponible en logic.js"
                  >
                    <Icon name="database" size={13} /> API
                  </Button>
                )}
                <Button variant="primary" onClick={save} disabled={saving || !dirty}>
                  <Icon name="save" size={13} /> {saving ? "Guardando..." : "Guardar"}
                </Button>
              </div>
              {showApi && active === "logic.js" && <ApiHelp />}
              <CodeEditor
                value={content}
                onChange={setContent}
                language={langOf(active)}
              />
              <div style={{ fontSize: 11, color: "var(--wtm-text-dim)", marginTop: 6 }}>
                {hintFor(active, builtin)}
              </div>
            </>
          ) : (
            !loading && <Notice>Elige un archivo de la izquierda para editarlo.</Notice>
          )}
        </div>
      </div>

      {builtin && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <Button variant="default" onClick={doRebuild} disabled={rebuilding}>
            <Icon name="refresh" size={13} />{" "}
            {rebuilding ? "Recompilando..." : "Recompilar sistema"}
          </Button>
          <span style={{ fontSize: 11, color: "var(--wtm-text-dim)" }}>
            Los modulos compilados necesitan recompilar para aplicar cambios.
          </span>
        </div>
      )}
    </div>
  );
}

/** Referencia rapida de la API `wtm` disponible dentro de logic.js. */
function ApiHelp() {
  return (
    <div className="wtm-apihelp">
      <div className="wtm-apihelp__title">API disponible en logic.js</div>
      <table>
        <tbody>
          <tr><td><code>wtm.data.list(filtro)</code></td><td>Registros de este modulo</td></tr>
          <tr><td><code>wtm.data.count(filtro)</code></td><td>Cuantos registros hay</td></tr>
          <tr><td><code>wtm.data.sum('col', filtro)</code></td><td>Suma una columna numerica</td></tr>
          <tr><td><code>wtm.related.list('modulo', filtro)</code></td><td>Leer datos de OTRO modulo</td></tr>
          <tr><td><code>wtm.companyId / wtm.user</code></td><td>Empresa y usuario actuales</td></tr>
          <tr><td><code>wtm.now() / wtm.uuid()</code></td><td>Fecha ISO / id unico</td></tr>
        </tbody>
      </table>
      <div className="wtm-apihelp__hooks">
        Hooks: <code>validate</code>, <code>beforeSave</code>, <code>afterSave</code>, <code>compute</code> — cada uno recibe <code>(record, ctx, wtm)</code>.
      </div>
    </div>
  );
}

function hintFor(path: string, builtin: boolean): string {
  if (builtin)
    return "Codigo fuente del modulo (TypeScript). Al guardar, pulsa 'Recompilar sistema' para que tome efecto.";
  if (path === "manifest.json")
    return "Metadatos del modulo (nombre, icono, color, alcance, permisos). Debe ser JSON valido.";
  if (path === "schema.json")
    return "Campos de datos del modulo. Cambiar aqui equivale a usar el constructor visual.";
  if (path === "logic.js")
    return "Logica opcional (validar, calcular, eventos). Se ejecuta en un entorno seguro; los cambios se aplican al guardar.";
  return "Archivo libre del modulo.";
}
