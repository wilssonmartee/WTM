/**
 * Utilidades para el modulo Articulos:
 *  - Guardar/recuperar el handle del archivo DBF (File System Access API) en
 *    IndexedDB, para recordar el archivo elegido entre sesiones.
 *  - Comprimir/descomprimir gzip con las APIs nativas del navegador.
 */

const DB_NAME = "wtm-articulos";
const STORE = "handles";
const HANDLE_KEY = "dbf";

// --- IndexedDB minimo ---
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemFileHandle | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(HANDLE_KEY);
        r.onsuccess = () => resolve((r.result as FileSystemFileHandle) ?? null);
        r.onerror = () => reject(r.error);
      },
    );
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearHandle(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/** La File System Access API esta disponible (Chromium/WebView2). */
export function supportsFsAccess(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown })
    .showOpenFilePicker === "function";
}

/** Verifica/solicita permiso de lectura sobre un handle guardado. */
export async function ensureReadPermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  // Tipos no estandar aun; casteamos.
  const h = handle as unknown as {
    queryPermission(d: { mode: string }): Promise<PermissionState>;
    requestPermission(d: { mode: string }): Promise<PermissionState>;
  };
  if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
  return (await h.requestPermission({ mode: "read" })) === "granted";
}

// --- gzip con CompressionStream ---
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data; // sin soporte: crudo
  const cs = new CompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  // Detecta si realmente es gzip (magic 0x1f 0x8b); si no, lo devuelve tal cual.
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  if (typeof DecompressionStream === "undefined") return data;
  const ds = new DecompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
