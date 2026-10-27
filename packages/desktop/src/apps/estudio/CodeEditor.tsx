import { useRef } from "react";

/**
 * Editor de codigo robusto y simple: un <textarea> con texto CLARO y visible,
 * numeros de linea, fuente monoespaciada, Tab = 2 espacios y auto-indentado.
 *
 * Deliberadamente SIN overlay de resaltado (esa tecnica es fragil y causaba
 * texto invisible/desalineado). Prioriza que editar funcione siempre.
 */
export function CodeEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  readOnly?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = Math.max(1, value.split("\n").length);

  function syncScroll() {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    const ta = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    } else if (e.key === "Enter") {
      const start = ta.selectionStart;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const indentMatch = value.slice(lineStart, start).match(/^[ \t]*/);
      const indent = indentMatch ? indentMatch[0] : "";
      if (indent) {
        e.preventDefault();
        const next =
          value.slice(0, start) + "\n" + indent + value.slice(ta.selectionEnd);
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
        autoComplete="off"
        readOnly={readOnly}
        wrap="off"
        placeholder="(archivo vacio)"
      />
    </div>
  );
}

export function langOf(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".ts")) return "typescript";
  return "text";
}
