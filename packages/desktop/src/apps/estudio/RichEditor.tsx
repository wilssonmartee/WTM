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
 * Editor rico (CodeMirror 6). Se carga de forma PEREZOSA (lazy) desde
 * CodeEditor, para que el bundle principal no dependa de el y el build nunca
 * falle si la dependencia no esta. Export default para React.lazy.
 */
export default function RichEditor({
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
        EditorView.updateListener.of(
          (u: { docChanged: boolean; state: EditorState }) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          },
        ),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12.5px" },
          ".cm-scroller": { fontFamily: "var(--wtm-mono)", lineHeight: "1.5" },
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

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: langComp.current.reconfigure(languageExt(language)),
    });
  }, [language]);

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
