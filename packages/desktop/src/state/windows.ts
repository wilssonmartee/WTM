import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesktopLayout,
  ModuleInfo,
  ModuleManifest,
  SavedGeometry,
} from "@wtm/shared";
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
  | "maximize-all"
  | "center-all";

/** Zonas de acople al arrastrar al borde (estilo Windows Snap). */
export type SnapZone =
  | null
  | "left"
  | "right"
  | "top"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

let seq = 1;
let topZ = 10;

/** Dada una zona de snap, devuelve la geometria resultante. */
export function snapGeom(zone: SnapZone, taskbarH: number) {
  const W = window.innerWidth;
  const H = window.innerHeight - taskbarH;
  const halfW = Math.floor(W / 2);
  const halfH = Math.floor(H / 2);
  switch (zone) {
    case "left":
      return { x: 0, y: 0, width: halfW, height: H, maximized: false };
    case "right":
      return { x: halfW, y: 0, width: W - halfW, height: H, maximized: false };
    case "top":
      return { maximized: true };
    case "top-left":
      return { x: 0, y: 0, width: halfW, height: halfH, maximized: false };
    case "top-right":
      return { x: halfW, y: 0, width: W - halfW, height: halfH, maximized: false };
    case "bottom-left":
      return { x: 0, y: halfH, width: halfW, height: H - halfH, maximized: false };
    case "bottom-right":
      return {
        x: halfW,
        y: halfH,
        width: W - halfW,
        height: H - halfH,
        maximized: false,
      };
    default:
      return null;
  }
}

/** Detecta la zona de snap segun la posicion del cursor cerca de los bordes. */
export function detectSnapZone(
  clientX: number,
  clientY: number,
  taskbarH: number,
): SnapZone {
  const W = window.innerWidth;
  const H = window.innerHeight - taskbarH;
  const edge = 24; // margen de activacion
  const corner = 80; // zona de esquina
  const nearLeft = clientX <= edge;
  const nearRight = clientX >= W - edge;
  const nearTop = clientY <= edge;

  if (nearTop && clientX <= corner) return "top-left";
  if (nearTop && clientX >= W - corner) return "top-right";
  if (nearLeft && clientY <= corner) return "top-left";
  if (nearLeft && clientY >= H - corner) return "bottom-left";
  if (nearRight && clientY <= corner) return "top-right";
  if (nearRight && clientY >= H - corner) return "bottom-right";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  if (nearTop) return "top";
  return null;
}

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
  // Ultima geometria conocida por modulo (persiste aunque se cierre).
  const geometry = useRef<Record<string, SavedGeometry>>({});

  // --- Restaurar del servidor al tener usuario + catalogo ---
  useEffect(() => {
    if (starting.current) return;
    if (!userId || catalog.length === 0) return;
    starting.current = true;
    api
      .getLayout()
      .then((layout) => {
        geometry.current = layout.geometry ?? {};
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

  // Mantener la memoria de geometria por modulo al dia con las ventanas
  // abiertas (sin maximizar, para recordar el tamano "normal").
  useEffect(() => {
    for (const w of windows) {
      if (!w.maximized) {
        geometry.current[w.module.id] = {
          x: w.x,
          y: w.y,
          width: w.width,
          height: w.height,
          maximized: false,
        };
      } else {
        // Recordamos que estaba maximizada, conservando el tamano previo.
        const prev = geometry.current[w.module.id];
        geometry.current[w.module.id] = {
          x: prev?.x ?? w.x,
          y: prev?.y ?? w.y,
          width: prev?.width ?? w.width,
          height: prev?.height ?? w.height,
          maximized: true,
        };
      }
    }
  }, [windows]);

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
        geometry: geometry.current,
      };
      api.saveLayout(layout).catch(() => {
        /* reintentara en el proximo cambio */
      });
    }, 500);
  }, [windows, userId]);

  // --- Rescate: si el cliente se redimensiona y una ventana queda fuera de
  // vista, la reacomodamos para que siempre quede una parte accesible. ---
  useEffect(() => {
    const onResize = () => {
      const W = window.innerWidth;
      const H = window.innerHeight - taskbarH;
      const MARGIN = 80; // minimo visible de la ventana
      setWindows((ws) =>
        ws.map((w) => {
          if (w.maximized) return w;
          let { x, y, width, height } = w;
          width = Math.min(width, W);
          height = Math.min(height, H);
          // Mantener al menos MARGIN px visibles por cada eje.
          x = Math.min(x, W - MARGIN);
          x = Math.max(x, -(width - MARGIN));
          y = Math.min(y, H - 40);
          y = Math.max(y, 0);
          if (x === w.x && y === w.y && width === w.width && height === w.height)
            return w;
          return { ...w, x, y, width, height };
        }),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [taskbarH]);

  const focus = useCallback((id: number) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, z: ++topZ, minimized: false } : w)),
    );
  }, []);

  const open = useCallback(
    (module: ModuleManifest) => {
      setWindows((ws) => {
        const existing = ws.find((w) => w.module.id === module.id);
        if (existing) {
          return ws.map((w) =>
            w.id === existing.id ? { ...w, z: ++topZ, minimized: false } : w,
          );
        }

        // Reabrir con la ultima geometria recordada del modulo (aunque se
        // hubiera cerrado). Si quedaria fuera de pantalla, se centra.
        const remembered = geometry.current[module.id];
        let g;
        if (remembered) {
          const { w: W, h: H } = workArea(taskbarH);
          let { x, y, width, height, maximized } = remembered;
          width = Math.min(width, W);
          height = Math.min(height, H);
          const offscreen =
            x < -width + 80 || x > W - 80 || y < 0 || y > H - 40;
          if (offscreen) {
            x = Math.max(0, Math.floor((W - width) / 2));
            y = Math.max(0, Math.floor((H - height) / 2));
          }
          g = { x, y, width, height, maximized };
        } else {
          g = { ...defaultGeom(module.id, ws.length), maximized: false };
        }

        return [
          ...ws,
          {
            id: seq++,
            module,
            ...g,
            z: ++topZ,
            minimized: false,
          },
        ];
      });
    },
    [taskbarH],
  );

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

  /** Aplica un acople (snap) a una ventana, p.ej. tras soltarla en un borde. */
  const snapTo = useCallback(
    (id: number, zone: SnapZone) => {
      const g = snapGeom(zone, taskbarH);
      if (!g) return;
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, ...g, z: ++topZ } : w)),
      );
    },
    [taskbarH],
  );

  /** Trae una ventana al centro con un tamano visible (rescate). */
  const center = useCallback(
    (id: number) => {
      const { w: W, h: H } = workArea(taskbarH);
      setWindows((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const width = Math.min(w.width, W - 40);
          const height = Math.min(w.height, H - 40);
          return {
            ...w,
            maximized: false,
            minimized: false,
            width,
            height,
            x: Math.max(0, Math.floor((W - width) / 2)),
            y: Math.max(0, Math.floor((H - height) / 2)),
            z: ++topZ,
          };
        }),
      );
    },
    [taskbarH],
  );

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
        } else if (mode === "center-all") {
          // Rescate: trae todas las ventanas visibles al centro, escalonadas.
          const step = 30;
          const cw = Math.min(760, Math.floor(W * 0.7));
          const ch = Math.min(520, Math.floor(H * 0.7));
          visible.forEach((win, i) => {
            geom.set(win.id, {
              x: Math.max(0, Math.floor((W - cw) / 2) + i * step - step),
              y: Math.max(0, Math.floor((H - ch) / 2) + i * step - step),
              width: cw,
              height: ch,
              maximized: false,
              minimized: false,
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
    snapTo,
    center,
  };
}
