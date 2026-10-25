import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleInfo, ModuleManifest } from "@wtm/shared";

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

/** Forma persistida de una ventana (sin z, que se recalcula). */
interface SavedWin {
  moduleId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  minimized: boolean;
}

let seq = 1;
let topZ = 10;

function storageKey(userId: string | null): string {
  return `wtm.windows.${userId ?? "anon"}`;
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

/**
 * Gestor de ventanas del escritorio con persistencia por usuario.
 *
 * - Recuerda posicion/tamano/maximizado de cada ventana.
 * - Al volver a entrar (o reabrir el cliente), restaura los modulos que
 *   estaban abiertos, cada uno como estaba.
 *
 * El estado se guarda en localStorage con una clave por usuario, de modo que
 * cada usuario conserva su propio escritorio en ese navegador/cliente.
 */
export function useWindows(
  userId: string | null,
  catalog: ModuleInfo[],
) {
  const [windows, setWindows] = useState<WinState[]>([]);
  const restored = useRef(false);

  // --- Restaurar al tener usuario + catalogo ---
  useEffect(() => {
    if (restored.current) return;
    if (!userId || catalog.length === 0) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(storageKey(userId));
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedWin[];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const restoredWins: WinState[] = [];
      for (const s of saved) {
        const mod = catalog.find((m) => m.id === s.moduleId);
        if (!mod) continue; // modulo ya no existe
        // Acotar tamano y posicion al viewport actual (por si la pantalla
        // ahora es mas pequena que la ultima vez).
        const width = Math.min(s.width, vw);
        const height = Math.min(s.height, vh - 60);
        const x = Math.max(0, Math.min(s.x, vw - 120));
        const y = Math.max(0, Math.min(s.y, vh - 100));
        restoredWins.push({
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
      if (restoredWins.length > 0) setWindows(restoredWins);
    } catch {
      /* si el guardado esta corrupto, empezamos limpio */
    }
  }, [userId, catalog]);

  // --- Guardar en cada cambio (con pequeno debounce) ---
  useEffect(() => {
    if (!userId || !restored.current) return;
    const t = setTimeout(() => {
      const saved: SavedWin[] = windows.map((w) => ({
        moduleId: w.module.id,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        maximized: w.maximized,
        minimized: w.minimized,
      }));
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(saved));
      } catch {
        /* sin espacio: ignorar */
      }
    }, 300);
    return () => clearTimeout(t);
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
