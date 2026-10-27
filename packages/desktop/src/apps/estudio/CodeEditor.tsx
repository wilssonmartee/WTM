import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  foldKeymap,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

/**
 * Editor de codigo real basado en CodeMirror 6: resaltado de sintaxis, numeros
 * de linea, plegado, auto-indentado, deshacer/rehacer, Tab para indentar,
 * emparejado de parentesis y tema oscuro. Soporta JSON, JavaScript/TypeScript.
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
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Crear el editor una vez.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightActiveLine(),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
        oneDark,
        langComp.current.of(languageExt(language)),
        roComp.current.of(EditorState.readOnly.of(!!readOnly)),
        EditorView.updateListener.of((u: { docChanged: boolean; state: EditorState }) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12.5px" },
          ".cm-scroller": {
            fontFamily: "var(--wtm-mono)",
            lineHeight: "1.5",
          },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizar el valor cuando cambia desde fuera (abrir otro archivo).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Cambiar el lenguaje al abrir otro archivo.
  useEffect(() => {
    view.current?.dispatch({
      effects: langComp.current.reconfigure(languageExt(language)),
    });
  }, [language]);

  // Cambiar readOnly.
  useEffect(() => {
    view.current?.dispatch({
      effects: roComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
    });
  }, [readOnly]);

  return <div className="wtm-cm" ref={host} />;
}

function languageExt(language?: string) {
  if (language === "json") return json();
  if (language === "javascript" || language === "typescript")
    return javascript({ typescript: language === "typescript" });
  return [];
}

export function langOf(path: string): string {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "text";
}
