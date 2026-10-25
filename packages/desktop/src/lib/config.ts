/**
 * Resolucion de la URL del servidor (core).
 *
 * El cliente guarda a que servidor se conecta. Esto permite que el mismo
 * cliente (web o nativo) apunte a:
 *  - un core local (\\server, IP de LAN)
 *  - un VPS remoto (IP publica, dominio, DDNS)
 */

const STORAGE_KEY = "wtm.serverUrl";

/**
 * Detecta si corremos dentro de la app nativa (Tauri) en vez del navegador.
 * En Tauri la pagina se sirve desde un origen local (tauri://, file://,
 * http://tauri.localhost), por lo que NO podemos asumir que el core esta en
 * el mismo host: el usuario debe elegir el servidor.
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) return true;
  const proto = window.location.protocol;
  return (
    proto === "tauri:" ||
    proto === "file:" ||
    window.location.hostname === "tauri.localhost"
  );
}

function defaultServerUrl(): string {
  // En la app nativa no hay servidor por defecto: el usuario lo indica.
  if (isNativeApp()) return "http://localhost:4000";

  // En web, el core sirve el escritorio y la API en el MISMO origen.
  // Por eso usamos exactamente el origen de la pagina (protocolo + host +
  // puerto), sin inventar el puerto 4000. Esto funciona tanto si entras por
  // http://localhost:4000 como por http://servidor (detras de un proxy),
  // http://IP:4000, https://dominio, etc.
  const { protocol, hostname, port } = window.location;

  // Caso de desarrollo con Vite: la UI corre en :5173 y el core en :4000.
  if (port === "5173") return `${protocol}//${hostname}:4000`;

  // En cualquier otro caso, el mismo origen de la pagina.
  return window.location.origin;
}

export function getServerUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  // En el cliente WEB ignoramos un valor guardado: el core siempre esta en el
  // mismo origen que sirvio la pagina. Guardar un servidor solo tiene sentido
  // en la app nativa, que no esta servida por ningun core.
  if (!isNativeApp()) return defaultServerUrl();
  return stored ?? defaultServerUrl();
}

export function hasStoredServer(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ""));
}

export function wsUrl(path: string, token: string): string {
  const base = getServerUrl().replace(/^http/, "ws");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}
