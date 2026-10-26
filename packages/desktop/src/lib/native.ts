/**
 * Puente al cliente nativo (Tauri). Lo inyecta el cliente de escritorio como
 * window.__WTM_NATIVE__. En el navegador web no existe (native() => null).
 *
 * Permite acceso real al disco: elegir archivo/carpeta y releer por RUTA sin
 * volver a seleccionar — lo que el navegador no puede hacer.
 */
export interface NativeBridge {
  available: boolean;
  pickFile(): Promise<string | null>;
  pickDir(): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  listDir(
    path: string,
  ): Promise<{ name: string; is_dir: boolean; size: number }[]>;
  /** Alterna pantalla completa (equivale a F11). */
  toggleFullscreen?(): Promise<void>;
  /** Sale de pantalla completa si lo esta. */
  exitFullscreen?(): Promise<void>;
  /** Devuelve si la ventana esta en pantalla completa. */
  isFullscreen?(): Promise<boolean>;
}

export function native(): NativeBridge | null {
  const w = window as unknown as { __WTM_NATIVE__?: NativeBridge };
  return w.__WTM_NATIVE__?.available ? w.__WTM_NATIVE__ : null;
}

export function isNative(): boolean {
  return native() !== null;
}
