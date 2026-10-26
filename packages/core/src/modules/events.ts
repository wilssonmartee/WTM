/**
 * Bus de eventos de modulos hacia los clientes (via WebSocket de sistema).
 *
 * Permite que cualquier modulo emita progreso en tiempo real (p.ej. Articulos
 * leyendo un DBF grande por SMB) sin acoplarse al servidor HTTP/WS. index.ts
 * conecta el emisor real al arrancar; si no hay cliente, los eventos se
 * descartan silenciosamente.
 */

export interface ModuleEvent {
  type: "module-progress";
  moduleId: string;
  /** Fase legible: "leyendo", "comprimiendo", "listo", "error". */
  phase: string;
  /** 0..100 o null si es indeterminado. */
  percent: number | null;
  /** Texto corto para la UI. */
  detail?: string;
  /** true cuando la operacion termino bien (los datos ya estan en cache). */
  done?: boolean;
  /** Mensaje de error si la operacion fallo. */
  error?: string;
}

let broadcaster: ((ev: ModuleEvent) => void) | null = null;

/** index.ts registra aqui el emisor real (broadcast por WS de sistema). */
export function setModuleEventBroadcaster(fn: (ev: ModuleEvent) => void): void {
  broadcaster = fn;
}

/** Un modulo emite un evento de progreso. */
export function emitModuleEvent(ev: ModuleEvent): void {
  try {
    broadcaster?.(ev);
  } catch {
    /* nunca dejar que un fallo de broadcast rompa la operacion */
  }
}
