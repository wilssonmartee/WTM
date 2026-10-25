import { useEffect, useRef, useState } from "react";
import type { TerminalLine } from "@wtm/shared";
import { getToken } from "../lib/api";
import { wsUrl } from "../lib/config";

interface Entry {
  prompt?: string;
  lines: TerminalLine[];
}

export function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cwd, setCwd] = useState("/");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
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
      } else if (msg.type === "result") {
        if (msg.lines.length === 1 && msg.lines[0].text === "\f") {
          setEntries([]);
        } else {
          setEntries((e) => {
            const last = [...e];
            last[last.length - 1] = {
              ...last[last.length - 1],
              lines: msg.lines,
            };
            return last;
          });
        }
        setCwd(msg.cwd);
      } else if (msg.type === "error") {
        setEntries((e) => [
          ...e,
          { lines: [{ kind: "stderr", text: msg.message }] },
        ]);
      }
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight);
  }, [entries]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const command = input;
    if (command.trim()) {
      history.current.push(command);
      histIdx.current = history.current.length;
    }
    setEntries((prev) => [...prev, { prompt: command, lines: [] }]);
    ws.current?.send(JSON.stringify({ command }));
    setInput("");
  }

  function onKey(e: React.KeyboardEvent) {
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
    }
  }

  const promptLabel = `wtm:${cwd}$`;

  return (
    <div className="wtm-term">
      <div className="wtm-term__out" ref={outRef}>
        {entries.map((entry, i) => (
          <div key={i}>
            {entry.prompt !== undefined && (
              <div>
                <span style={{ color: "#34d399" }}>{promptLabel} </span>
                {entry.prompt}
              </div>
            )}
            {entry.lines.map((l, j) => (
              <div key={j} className={`wtm-term__line--${l.kind}`}>
                {l.text}
              </div>
            ))}
          </div>
        ))}
        {!connected && (
          <div className="wtm-term__line--stderr">
            [sin conexion con el core]
          </div>
        )}
      </div>
      <form className="wtm-term__prompt" onSubmit={send}>
        <span>{promptLabel}</span>
        <input
          className="wtm-term__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          autoFocus
          spellCheck={false}
          disabled={!connected}
        />
      </form>
    </div>
  );
}
