import { useRef, type ReactNode } from "react";
import type { WinState } from "../state/windows";
import { Icon } from "./Icon";

interface Props {
  win: WinState;
  taskbarH: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMax: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  children: ReactNode;
}

export function Window({
  win,
  taskbarH,
  onFocus,
  onClose,
  onMinimize,
  onToggleMax,
  onMove,
  onResize,
  children,
}: Props) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const rez = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(
    null,
  );

  if (win.minimized) return null;

  function startDrag(e: React.MouseEvent) {
    if (win.maximized) return;
    onFocus();
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
  }
  function onDrag(e: MouseEvent) {
    if (!drag.current) return;
    const x = Math.max(0, e.clientX - drag.current.dx);
    const y = Math.max(0, e.clientY - drag.current.dy);
    onMove(x, y);
  }
  function stopDrag() {
    drag.current = null;
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", stopDrag);
  }

  function startResize(e: React.MouseEvent) {
    e.stopPropagation();
    onFocus();
    rez.current = {
      sx: e.clientX,
      sy: e.clientY,
      sw: win.width,
      sh: win.height,
    };
    window.addEventListener("mousemove", onRez);
    window.addEventListener("mouseup", stopRez);
  }
  function onRez(e: MouseEvent) {
    if (!rez.current) return;
    const w = Math.max(320, rez.current.sw + (e.clientX - rez.current.sx));
    const h = Math.max(200, rez.current.sh + (e.clientY - rez.current.sy));
    onResize(w, h);
  }
  function stopRez() {
    rez.current = null;
    window.removeEventListener("mousemove", onRez);
    window.removeEventListener("mouseup", stopRez);
  }

  const style: React.CSSProperties = win.maximized
    ? {
        left: 0,
        top: 0,
        width: "100vw",
        height: `calc(100vh - ${taskbarH}px)`,
        zIndex: win.z,
      }
    : {
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.z,
      };

  return (
    <div
      className={`wtm-window ${win.maximized ? "wtm-window--max" : ""}`}
      style={style}
      onMouseDown={onFocus}
    >
      <div
        className="wtm-window__titlebar"
        onMouseDown={startDrag}
        onDoubleClick={onToggleMax}
      >
        <div className="wtm-window__title">
          <Icon name={win.module.icon} size={14} />
          {win.module.name}
          {win.module.status === "coming-soon" && (
            <span className="wtm-window__badge">vista previa</span>
          )}
        </div>
        <div className="wtm-window__controls">
          <button className="wtm-wbtn" onClick={onMinimize} title="Minimizar">
            <svg width="11" height="11" viewBox="0 0 11 11">
              <line x1="2" y1="6" x2="9" y2="6" stroke="currentColor" />
            </svg>
          </button>
          <button className="wtm-wbtn" onClick={onToggleMax} title="Maximizar">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <rect
                x="2"
                y="2"
                width="7"
                height="7"
                stroke="currentColor"
                rx="1"
              />
            </svg>
          </button>
          <button
            className="wtm-wbtn wtm-wbtn--close"
            onClick={onClose}
            title="Cerrar"
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <line x1="2.5" y1="2.5" x2="8.5" y2="8.5" stroke="currentColor" />
              <line x1="8.5" y1="2.5" x2="2.5" y2="8.5" stroke="currentColor" />
            </svg>
          </button>
        </div>
      </div>
      <div className="wtm-window__body">{children}</div>
      {!win.maximized && (
        <div className="wtm-window__resize" onMouseDown={startResize} />
      )}
    </div>
  );
}
