import { Component, Suspense, lazy, type ReactNode } from "react";
import { PlainEditor } from "./PlainEditor";

/**
 * Editor de codigo con carga PEREZOSA del editor rico (CodeMirror) y respaldo
 * robusto. Si CodeMirror no carga (falta la dependencia o error en runtime),
 * cae a un textarea con numeros de linea para que editar funcione SIEMPRE.
 *
 * El editor rico se importa con lazy() para no cargarlo hasta que hace falta.
 */

const RichEditor = lazy(() => import("./RichEditor"));

interface Props {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  readOnly?: boolean;
}

/** Captura errores del editor rico y cae al editor simple. */
class EditorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function CodeEditor(props: Props) {
  const fallback = (
    <PlainEditor
      value={props.value}
      onChange={props.onChange}
      readOnly={props.readOnly}
    />
  );
  return (
    <EditorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <RichEditor {...props} />
      </Suspense>
    </EditorBoundary>
  );
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
