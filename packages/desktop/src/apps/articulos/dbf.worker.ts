/// <reference lib="webworker" />
// Web Worker: parsea el DBF en un hilo aparte para no congelar la UI.
// Ademas precalcula, por registro, el texto normalizado para busqueda rapida.
import { parseDbf, normalizeText } from "./dbf";

export interface WorkerRequest {
  buffer: ArrayBuffer;
  encoding: string;
}
export interface WorkerResponse {
  ok: boolean;
  error?: string;
  fields?: { name: string; type: string; length: number; decimals: number }[];
  records?: Record<string, unknown>[];
  /** Texto normalizado por registro (mismo indice que records). */
  searchIndex?: string[];
  recordCount?: number;
  encoding?: string;
  detectedEncoding?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { buffer, encoding } = e.data;
  try {
    const t = parseDbf(buffer, encoding);
    // Precalcular el indice de busqueda de todos los campos de texto una vez.
    const searchIndex = t.records.map((row) =>
      normalizeText(Object.values(row).join(" ")),
    );
    const res: WorkerResponse = {
      ok: true,
      fields: t.fields,
      records: t.records,
      searchIndex,
      recordCount: t.recordCount,
      encoding: t.encoding,
      detectedEncoding: t.detectedEncoding,
    };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: WorkerResponse = {
      ok: false,
      error: err instanceof Error ? err.message : "Error al parsear DBF",
    };
    (self as unknown as Worker).postMessage(res);
  }
};
