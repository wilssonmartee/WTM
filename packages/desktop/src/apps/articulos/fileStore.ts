/**
 * Utilidades del modulo Articulos.
 *
 * El navegador no permite recordar la RUTA de un archivo local ni re-leerlo
 * solo, y el webview de Tauri restringe el IPC remoto. La solucion robusta que
 * funciona en TODOS los entornos (Tauri, Chrome, Safari): al elegir el DBF,
 * guardamos sus BYTES en IndexedDB. Asi al reabrir el sistema el archivo esta
 * "recordado" (su contenido) y carga al instante, sin re-seleccionar. El boton
 * "Actualizar" vuelve a pedir el archivo solo cuando quieres datos frescos.
 *
 * Tambien: gzip/gunzip con las APIs nativas del navegador.
 */

const DB_NAME = "wtm-articulos";
const STORE = "files";
const KEY = "dbf";

interface StoredFile {
  name: string;
  bytes: ArrayBuffer;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // Limpieza de la version anterior (handles).
      if (db.objectStoreNames.contains("handles"))
        db.deleteObjectStore("handles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Guarda los bytes del DBF elegido (su contenido) en IndexedDB. */
export async function saveFileBytes(
  name: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const value: StoredFile = { name, bytes, at: Date.now() };
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFileBytes(): Promise<StoredFile | null> {
  try {
    const db = await openDb();
    const value = await new Promise<StoredFile | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve((r.result as StoredFile) ?? null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}

export async function clearFileBytes(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}

// --- gzip con CompressionStream ---
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const cs = new CompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  if (typeof DecompressionStream === "undefined") return data;
  const ds = new DecompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
