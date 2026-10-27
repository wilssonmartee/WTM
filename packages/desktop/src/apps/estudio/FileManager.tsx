import { useCallback, useEffect, useState } from "react";
import { Button, Input, Notice } from "@wtm/ui";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { CodeEditor, langOf } from "./CodeEditor";

/**
 * Administrador de ARCHIVOS de un modulo (estilo editor de temas de WordPress):
 * lista los archivos del modulo, abre cualquiera en el editor de codigo, guarda
 * cambios, crea archivos nuevos y borra los que no sean del nucleo.
 */

interface FileItem {
  path: string;
  size: number;
  isDir: boolean;
}

const CORE_FILES = new Set(["manifest.json", "schema.json"]);

export function FileManager({ moduleId }: { moduleId: string }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);

  const dirty = content !== original;

  const loadFiles = useCallback(async () => {
    try {
      const list = await api.estudioFiles(moduleId);
      setFiles(list.filter((f) => !f.isDir));
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    }
  }, [moduleId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const open = useCallback(
    async (p: string) => {
      if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
      setLoading(true);
      setMsg(null);
      try {
        const r = await api.estudioReadFile(moduleId, p);
        setActive(p);
        setContent(r.content);
        setOriginal(r.content);
      } catch (e) {
        setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
      } finally {
        setLoading(false);
      }
    },
    [moduleId, dirty],
  );

  // Abrir el primer archivo util al cargar.
  useEffect(() => {
    if (!active && files.length > 0) {
      const pref =
        files.find((f) => f.path === "logic.js") ??
        files.find((f) => f.path === "manifest.json") ??
        files[0];
      if (pref) void open(pref.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  async function save() {
    if (!active) return;
    // Validar JSON antes de guardar para no romper el modulo.
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
      await api.estudioWriteFile(moduleId, active, content);
      setOriginal(content);
      setMsg({ tone: "success", text: "Archivo guardado. Los cambios ya estan activos." });
      await loadFiles();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setSaving(false);
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
      await api.estudioWriteFile(moduleId, name, "");
      setNewName("");
      setShowNew(false);
      await loadFiles();
      await open(name);
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
      await loadFiles();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Error" });
    }
  }

  return (
    <div className="wtm-filemgr">
      <div className="wtm-filemgr__side">
        <div className="wtm-filemgr__side-head">
          <span>Archivos</span>
          <button
            className="ui-btn ui-btn--ghost"
            style={{ padding: "2px 7px" }}
            title="Nuevo archivo"
            onClick={() => setShowNew((v) => !v)}
          >
            <Icon name="plus" size={13} />
          </button>
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
            <button className="ui-btn ui-btn--primary" style={{ padding: "2px 8px" }} onClick={createFile}>
              OK
            </button>
          </div>
        )}
        <div className="wtm-filemgr__list">
          {files.map((f) => (
            <div
              key={f.path}
              className={`wtm-filemgr__file ${active === f.path ? "is-active" : ""}`}
              onClick={() => open(f.path)}
            >
              <Icon name="code" size={12} />
              <span className="wtm-filemgr__name">{f.path}</span>
              {!CORE_FILES.has(f.path) && (
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
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {active ? (
          <>
            <div className="wtm-filemgr__bar">
              <span className="wtm-filemgr__active">
                {active}
                {dirty && <span style={{ color: "var(--wtm-accent)" }}> ●</span>}
              </span>
              <div style={{ flex: 1 }} />
              <Button variant="primary" onClick={save} disabled={saving || !dirty}>
                <Icon name="save" size={13} /> {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
            {loading ? (
              <Notice>Cargando...</Notice>
            ) : (
              <CodeEditor
                value={content}
                onChange={setContent}
                language={langOf(active)}
              />
            )}
            <div style={{ fontSize: 11, color: "var(--wtm-text-dim)", marginTop: 6 }}>
              {hintFor(active)}
            </div>
          </>
        ) : (
          <Notice>Elige un archivo de la izquierda para editarlo.</Notice>
        )}
      </div>
    </div>
  );
}

function hintFor(path: string): string {
  if (path === "manifest.json")
    return "Metadatos del modulo (nombre, icono, color, alcance, permisos). Debe ser JSON valido.";
  if (path === "schema.json")
    return "Campos de datos del modulo. Cambiar aqui equivale a usar el constructor visual.";
  if (path === "logic.js")
    return "Logica opcional (validar, calcular, eventos). Se ejecuta en un entorno seguro; los cambios se aplican al guardar.";
  return "Archivo libre del modulo.";
}
