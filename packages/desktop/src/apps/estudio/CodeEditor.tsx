import { useRef } from "react";

/**
 * Editor de codigo ligero sin dependencias: un textarea con numeros de linea,
 * fuente monoespaciada, tabulacion con Tab y auto-indentado basico. Suficiente
 * para editar JSON/JS/Markdown de un modulo desde la interfaz.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  readOnly?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = value.split("\n");
  const lineCount = lines.length;

  function syncScroll() {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    const ta = e.currentTarget;
    // Tab inserta 2 espacios (no cambia de foco).
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    // Enter mantiene la indentacion de la linea actual.
    else if (e.key === "Enter") {
      const start = ta.selectionStart;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const indentMatch = value.slice(lineStart, start).match(/^[ \t]*/);
      const indent = indentMatch ? indentMatch[0] : "";
      if (indent) {
        e.preventDefault();
        const next = value.slice(0, start) + "\n" + indent + value.slice(ta.selectionEnd);
        onChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1 + indent.length;
        });
      }
    }
  }

  return (
    <div className="wtm-code">
      <div className="wtm-code__gutter" ref={gutterRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="wtm-code__area"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        readOnly={readOnly}
        data-lang={language}
        wrap="off"
      />
    </div>
  );
}

/** Deduce el lenguaje por la extension del archivo (para el futuro resaltado). */
export function langOf(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "text";
}
