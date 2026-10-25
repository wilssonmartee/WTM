import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopLayout, ModuleInfo, ModuleManifest } from "@wtm/shared";
import { api } from "../lib/api";

export interface WinState {
  id: number;
  module: ModuleManifest;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  maximized: boolean;
  minimized: boolean;
}

export type ArrangeMode =
  | "left"
  | "right"
  | "grid"
  | "cascade"
  | "maximize-all";

let seq = 1;
let topZ = 10;

function defaultGeom(moduleId: string, count: number) {
  const offset = (count % 6) * 28;
  return {
    x: 120 + offset,
    y: 80 + offset,
    width: moduleId === "terminal" ? 620 : 700,
    height: moduleId === "terminal" ? 380 : 480,
  };
}

/** Area util del escritorio (descontando la barra de tareas). */
function workArea(taskbarH: number) {
  return {
    w: window.innerWidth,
    h: window.innerHeight - taskbarH,
  };
}

/**
 * Gestor de ventanas del escritorio con persistencia EN EL SERVIDOR.
 *
 * El layout (ventanas abiertas + geometria) se guarda por usuario via
 * /api/layout, de modo que el usuario encuentra su escritorio igual desde
 * cualquier dispositivo. Incluye auto-organizacion tipo Windows (acoplar a
 * izquierda/derecha, cuadricula, cascada).
 */
export function useWindows(
  userId: string | null,
  catalog: ModuleInfo[],
  taskbarH: number,
) {
  const [windows, setWindows] = useState<WinState[]>([]);
  const starting = useRef(false); // restauracion iniciada
  const ready = useRef(false); // restauracion terminada -> ya se puede guardar
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Restaurar del servidor al tener usuario + catalogo ---
  useEffect(() => {
    if (starting.current) return;
    if (!userId || catalog.length === 0) return;
    starting.current = true;
    api
      .getLayout()
      .then((layout) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const wins: WinState[] = [];
        for (const s of layout.windows ?? []) {
          const mod = catalog.find((m) => m.id === s.moduleId);
          if (!mod) continue;
          const width = Math.min(s.width, vw);
          const height = Math.min(s.height, vh - 60);
          const x = Math.max(0, Math.min(s.x, vw - 120));
          const y = Math.max(0, Math.min(s.y, vh - 100));
          wins.push({
            id: seq++,
            module: mod,
            x,
            y,
            width,
            height,
            z: ++topZ,
            maximized: s.maximized,
            minimized: s.minimized,
          });
        }
        if (wins.length > 0) setWindows(wins);
      })
      .catch(() => {
        /* sin layout guardado: escritorio vacio */
      })
      .finally(() => {
        // A partir de aqui, los cambios del usuario si se guardan.
        ready.current = true;
      });
  }, [userId, catalog]);

  // --- Guardar en el servidor en cada cambio (con debounce) ---
  useEffect(() => {
    if (!userId || !ready.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layout: DesktopLayout = {
        windows: windows.map((w) => ({
          moduleId: w.module.id,
          x: w.x,
          y: w.y,
          width: w.width,
          height: w.height,
          maximized: w.maximized,
          minimized: w.minimized,
        })),
      };
      api.saveLayout(layout).catch(() => {
        /* reintentara en el proximo cambio */
      });
    }, 500);
  }, [windows, userId]);

  const focus = useCallback((id: number) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, z: ++topZ, minimized: false } : w)),
    );
  }, []);

  const open = useCallback((module: ModuleManifest) => {
    setWindows((ws) => {
      const existing = ws.find((w) => w.module.id === module.id);
      if (existing) {
        return ws.map((w) =>
          w.id === existing.id ? { ...w, z: ++topZ, minimized: false } : w,
        );
      }
      const g = defaultGeom(module.id, ws.length);
      return [
        ...ws,
        {
          id: seq++,
          module,
          ...g,
          z: ++topZ,
          maximized: false,
          minimized: false,
        },
      ];
    });
  }, []);

  const close = useCallback((id: number) => {
    setWindows((ws) => ws.filter((w) => w.id !== id));
  }, []);

  const toggleMax = useCallback((id: number) => {
    setWindows((ws) =>
      ws.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized, z: ++topZ } : w,
      ),
    );
  }, []);

  const minimize = useCallback((id: number) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    );
  }, []);

  const move = useCallback((id: number, x: number, y: number) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resize = useCallback((id: number, width: number, height: number) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, width, height } : w)),
    );
  }, []);

  /** Auto-organiza las ventanas visibles (como el Snap de Windows). */
  const arrange = useCallback(
    (mode: ArrangeMode) => {
      setWindows((ws) => {
        const visible = ws.filter((w) => !w.minimized);
        if (visible.length === 0) return ws;
        const { w: W, h: H } = workArea(taskbarH);
        const geom = new Map<number, Partial<WinState>>();

        if (mode === "maximize-all") {
          for (const win of visible) geom.set(win.id, { maximized: true });
        } else if (mode === "left" || mode === "right") {
          // Media pantalla: la ventana activa (mayor z) va al lado elegido,
          // el resto se reparte en el otro lado apiladas.
          const sorted = [...visible].sort((a, b) => b.z - a.z);
          const main = sorted[0];
          const rest = sorted.slice(1);
          const half = Math.floor(W / 2);
          const mainX = mode === "left" ? 0 : half;
          const otherX = mode === "left" ? half : 0;
          geom.set(main.id, {
            x: mainX,
            y: 0,
            width: half,
            height: H,
            maximized: false,
          });
          rest.forEach((win, i) => {
            const rh = Math.floor(H / Math.max(1, rest.length));
            geom.set(win.id, {
              x: otherX,
              y: i * rh,
              width: half,
              height: rh,
              maximized: false,
            });
          });
        } else if (mode === "grid") {
          // Mosaico en cuadricula.
          const n = visible.length;
          const cols = Math.ceil(Math.sqrt(n));
          const rows = Math.ceil(n / cols);
          const cw = Math.floor(W / cols);
          const ch = Math.floor(H / rows);
          visible.forEach((win, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            geom.set(win.id, {
              x: c * cw,
              y: r * ch,
              width: cw,
              height: ch,
              maximized: false,
            });
          });
        } else if (mode === "cascade") {
          const step = 36;
          const cw = Math.min(760, Math.floor(W * 0.7));
          const ch = Math.min(520, Math.floor(H * 0.7));
          const sorted = [...visible].sort((a, b) => a.z - b.z);
          sorted.forEach((win, i) => {
            geom.set(win.id, {
              x: 40 + i * step,
              y: 20 + i * step,
              width: cw,
              height: ch,
              maximized: false,
            });
          });
        }

        return ws.map((w) =>
          geom.has(w.id) ? { ...w, ...geom.get(w.id), z: ++topZ } : w,
        );
      });
    },
    [taskbarH],
  );

  return {
    windows,
    open,
    close,
    focus,
    toggleMax,
    minimize,
    move,
    resize,
    arrange,
  };
}
