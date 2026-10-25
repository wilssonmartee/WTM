import { useCallback, useState } from "react";
import type { ModuleManifest } from "@wtm/shared";

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

let seq = 1;
let topZ = 10;

/** Gestor sencillo de ventanas del escritorio. */
export function useWindows() {
  const [windows, setWindows] = useState<WinState[]>([]);

  const focus = useCallback((id: number) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, z: ++topZ, minimized: false } : w)),
    );
  }, []);

  const open = useCallback((module: ModuleManifest) => {
    setWindows((ws) => {
      // Si ya esta abierto, lo enfocamos.
      const existing = ws.find((w) => w.module.id === module.id);
      if (existing) {
        return ws.map((w) =>
          w.id === existing.id
            ? { ...w, z: ++topZ, minimized: false }
            : w,
        );
      }
      const offset = (ws.length % 6) * 28;
      return [
        ...ws,
        {
          id: seq++,
          module,
          x: 120 + offset,
          y: 80 + offset,
          width: module.id === "terminal" ? 620 : 680,
          height: module.id === "terminal" ? 380 : 460,
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

  const resize = useCallback(
    (id: number, width: number, height: number) => {
      setWindows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, width, height } : w)),
      );
    },
    [],
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
  };
}
