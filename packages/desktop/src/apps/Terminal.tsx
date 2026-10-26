import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalLine } from "@wtm/shared";
import { getToken } from "../lib/api";
import { wsUrl } from "../lib/config";

interface Entry {
  /** Comando tecleado (si es una entrada de prompt). */
  prompt?: string;
  /** cwd en el momento del comando (para pintar el prompt). */
  cwd?: string;
  lines: TerminalLine[];
}

/**
 * Terminal del sistema WTM, al estilo de una shell Linux: el prompt de entrada
 * vive DENTRO del flujo del contenido (como la ultima linea), no en una barra
 * fija abajo. Cada comando deja su eco + salida en el historial y aparece un
 * nuevo prompt debajo. Soporta salida en vivo (streaming) para comandos largos
 * como 'wtm rebuild' o 'wtm restart'.
 */
export function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cwd, setCwd] = useState("/");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const histIdx = useRef<number>(-1);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = new WebSocket(wsUrl("/ws/terminal", token));
    ws.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "welcome") {
        setCwd(msg.cwd);
        setEntries([{ lines: [{ kind: "info", text: msg.message }] }]);
      } else if (msg.type === "line") {
        // Linea en vivo (streaming): la agregamos a la ultima entrada.
        setEntries((e) => {
          if (e.length === 0) return [{ lines: [msg.line] }];
          const copy = [...e];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, lines: [...last.lines, msg.line] };
          return copy;
        });
      } else if (msg.type === "result") {
        if (msg.lines.length === 1 && msg.lines[0].text === "\f") {
          setEntries([]);
        } else if (msg.lines.length > 0) {
          setEntries((e) => {
            const copy = [...e];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = {
              ...last,
              lines: [...last.lines, ...msg.lines],
            };
            return copy;
          });
        }
        setCwd(msg.cwd);
        setRunning(false);
      } else if (msg.type === "error") {
        setEntries((e) => [
          ...e,
          { lines: [{ kind: "stderr", text: msg.message }] },
        ]);
        setRunning(false);
      }
    };
    return () => socket.close();
  }, []);

  // Autoscroll al fondo cuando cambian las entradas.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [entries, running]);

  const focusInput = useCallback(() => {
    if (!running) inputRef.current?.focus();
  }, [running]);

  function submit() {
    const command = input;
    if (running) return;
    if (command.trim()) {
      history.current.push(command);
      histIdx.current = history.current.length;
    }
    // Deja el eco del comando con su prompt y abre una entrada para la salida.
    setEntries((prev) => [...prev, { prompt: command, cwd, lines: [] }]);
    ws.current?.send(JSON.stringify({ command }));
    setInput("");
    setRunning(true);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx.current > 0) {
        histIdx.current--;
        setInput(history.current[histIdx.current] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current < history.current.length - 1) {
        histIdx.current++;
        setInput(history.current[histIdx.current] ?? "");
      } else {
        histIdx.current = history.current.length;
        setInput("");
      }
    } else if (e.key === "l" && e.ctrlKey) {
      // Ctrl+L limpia la pantalla (como en bash).
      e.preventDefault();
      setEntries([]);
    }
  }

  const promptFor = (c: string) => `wtm:${c}$`;

  return (
    <div className="wtm-term" onClick={focusInput}>
      <div className="wtm-term__scroll" ref={scrollRef}>
        {entries.map((entry, i) => (
          <div key={i} className="wtm-term__entry">
            {entry.prompt !== undefined && (
              <div className="wtm-term__cmd">
                <span className="wtm-term__prompt-label">
                  {promptFor(entry.cwd ?? "/")}
                </span>{" "}
                <span className="wtm-term__cmd-text">{entry.prompt}</span>
              </div>
            )}
            {entry.lines.map((l, j) => (
              <div key={j} className={`wtm-term__line--${l.kind}`}>
                {l.text === "" ? "\u00a0" : l.text}
              </div>
            ))}
          </div>
        ))}

        {/* Prompt de entrada DENTRO del flujo (como una shell real). */}
        {connected ? (
          <div className="wtm-term__inputline">
            <span className="wtm-term__prompt-label">{promptFor(cwd)}</span>{" "}
            {running ? (
              <span className="wtm-term__busy">… ejecutando</span>
            ) : (
              <>
                <input
                  ref={inputRef}
                  className="wtm-term__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="wtm-term__caret" aria-hidden />
              </>
            )}
          </div>
        ) : (
          <div className="wtm-term__line--stderr">
            [sin conexion con el core]
          </div>
        )}
      </div>
    </div>
  );
}
