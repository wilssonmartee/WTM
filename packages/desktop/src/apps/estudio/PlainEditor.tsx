import { useRef } from "react";

/**
 * Editor de respaldo: un textarea robusto con numeros de linea. Se usa cuando
 * el editor rico (CodeMirror) no esta disponible, para que editar funcione
 * siempre, incluso si falta la dependencia.
 */
export function PlainEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
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
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      onChange(value.slice(0, s) + "  " + value.slice(en));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
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
