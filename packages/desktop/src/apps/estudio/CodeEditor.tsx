import { useRef } from "react";

/**
 * Editor de codigo ligero sin dependencias externas, con RESALTADO de sintaxis.
 *
 * Tecnica de overlay: un <pre> coloreado detras de un <textarea> transparente
 * perfectamente alineado. El usuario escribe en el textarea (cursor, seleccion
 * nativos) y ve los colores del <pre>. Soporta JSON y JavaScript (suficiente
 * para editar manifest.json/schema.json/logic.js de un modulo).
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
  const preRef = useRef<HTMLPreElement>(null);

  const lineCount = value.split("\n").length;

  function syncScroll() {
    const ta = taRef.current;
    if (!ta) return;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
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

  const highlighted = highlight(value, language ?? "text");

  return (
    <div className="wtm-code">
      <div className="wtm-code__gutter" ref={gutterRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="wtm-code__editwrap">
        <pre
          className="wtm-code__pre"
          ref={preRef}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
        />
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
          wrap="off"
        />
      </div>
    </div>
  );
}

export function langOf(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "text";
}

// ---- Resaltado de sintaxis minimo (sin dependencias) ----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Resaltado por tokens. Devuelve HTML con <span class="tok-*"> por categoria.
 * Se mantiene simple y robusto: strings, numeros, booleanos/null, palabras
 * clave de JS, comentarios. El texto se escapa antes de envolver.
 */
function highlight(code: string, lang: string): string {
  if (lang === "json") return highlightJson(code);
  if (lang === "javascript") return highlightJs(code);
  return escapeHtml(code);
}

function highlightJson(code: string): string {
  // Tokeniza: strings (clave/valor), numeros, booleanos/null, puntuacion.
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"') {
      // string hasta la comilla de cierre (respeta escapes)
      let j = i + 1;
      while (j < code.length && !(code[j] === '"' && code[j - 1] !== "\\")) j++;
      const str = code.slice(i, j + 1);
      // ¿es una clave? (le sigue ':')
      let k = j + 1;
      while (k < code.length && /\s/.test(code[k])) k++;
      const cls = code[k] === ":" ? "tok-key" : "tok-str";
      out += `<span class="${cls}">${escapeHtml(str)}</span>`;
      i = j + 1;
    } else if (/[0-9-]/.test(ch) && /[\s:,\[]/.test(code[i - 1] ?? " ")) {
      let j = i;
      while (j < code.length && /[0-9.eE+-]/.test(code[j])) j++;
      out += `<span class="tok-num">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
    } else if (code.startsWith("true", i) || code.startsWith("false", i) || code.startsWith("null", i)) {
      const word = code.startsWith("true", i) ? "true" : code.startsWith("false", i) ? "false" : "null";
      out += `<span class="tok-bool">${word}</span>`;
      i += word.length;
    } else {
      out += escapeHtml(ch);
      i++;
    }
  }
  return out;
}

const JS_KEYWORDS = new Set([
  "function", "return", "if", "else", "for", "while", "var", "let", "const",
  "new", "typeof", "null", "undefined", "true", "false", "this", "module",
  "exports", "require", "class", "try", "catch", "throw", "of", "in", "switch",
  "case", "break", "continue", "do", "default",
]);

function highlightJs(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const two = code.slice(i, i + 2);
    // Comentario de linea
    if (two === "//") {
      let j = i;
      while (j < code.length && code[j] !== "\n") j++;
      out += `<span class="tok-com">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
    }
    // Comentario de bloque
    else if (two === "/*") {
      const end = code.indexOf("*/", i + 2);
      const j = end === -1 ? code.length : end + 2;
      out += `<span class="tok-com">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
    }
    // String (comillas simples, dobles o backtick)
    else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && !(code[j] === ch && code[j - 1] !== "\\")) j++;
      out += `<span class="tok-str">${escapeHtml(code.slice(i, j + 1))}</span>`;
      i = j + 1;
    }
    // Numero
    else if (/[0-9]/.test(ch) && !/[a-zA-Z_]/.test(code[i - 1] ?? " ")) {
      let j = i;
      while (j < code.length && /[0-9.eExX+-]/.test(code[j])) j++;
      out += `<span class="tok-num">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
    }
    // Identificador / palabra clave
    else if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (JS_KEYWORDS.has(word)) {
        out += `<span class="tok-kw">${word}</span>`;
      } else {
        out += escapeHtml(word);
      }
      i = j;
    } else {
      out += escapeHtml(ch);
      i++;
    }
  }
  return out;
}
