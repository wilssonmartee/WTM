/**
 * Parser de archivos DBF (dBASE III/IV, FoxPro, Visual FoxPro) en TypeScript
 * puro, pensado para correr en el navegador. Sin dependencias.
 *
 * Soporta: deteccion de codificacion por el byte "language driver" del header,
 * y decodificacion con TextDecoder (windows-1252, ibm850, latin1, utf-8, etc.).
 * Lee campos C (texto), N/F (numeros), D (fecha), L (logico), M (memo -> omitido).
 */

export interface DbfField {
  name: string;
  type: string; // C, N, F, D, L, M, I, B, T, Y...
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  records: Record<string, unknown>[];
  recordCount: number;
  encoding: string;
  detectedEncoding: string;
}

/** Codificaciones ofrecidas en la UI. */
export const ENCODINGS = [
  { id: "auto", label: "Automatica" },
  { id: "windows-1252", label: "Windows-1252 (ANSI)" },
  { id: "ibm850", label: "MS-DOS (CP850)" },
  { id: "ibm437", label: "MS-DOS (CP437)" },
  { id: "iso-8859-1", label: "Latin-1 (ISO-8859-1)" },
  { id: "utf-8", label: "UTF-8" },
] as const;

/**
 * Mapa del byte "language driver" (offset 29 del header) a codificacion.
 * Cubre los valores mas comunes de FoxPro/dBASE.
 */
const LANG_DRIVER: Record<number, string> = {
  0x01: "ibm437", // US MS-DOS
  0x02: "ibm850", // International MS-DOS
  0x03: "windows-1252", // Windows ANSI
  0x64: "ibm852", // Eastern European MS-DOS
  0x65: "ibm866", // Russian MS-DOS
  0x6a: "ibm737", // Greek MS-DOS
  0x6b: "ibm857", // Turkish MS-DOS
  0x57: "windows-1252", // ANSI
  0xc8: "windows-1250", // Windows EE
  0xc9: "windows-1251", // Russian Windows
  0x58: "windows-1252", // Western European Windows
  0x59: "windows-1252",
};

function detectEncoding(languageDriver: number): string {
  return LANG_DRIVER[languageDriver] ?? "windows-1252";
}

/** Crea un TextDecoder tolerante; si la etiqueta no existe, cae a 1252. */
function makeDecoder(label: string): TextDecoder {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return new TextDecoder("windows-1252", { fatal: false });
  }
}

export function parseDbf(
  buffer: ArrayBuffer,
  encodingChoice = "auto",
): DbfTable {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // --- Header ---
  // offset 4-7: numero de registros (uint32 LE)
  const recordCount = view.getUint32(4, true);
  // offset 8-9: bytes del header (uint16 LE) -> donde empiezan los registros
  const headerSize = view.getUint16(8, true);
  // offset 10-11: longitud de cada registro
  const recordSize = view.getUint16(10, true);
  // offset 29: language driver (codepage)
  const languageDriver = bytes[29];

  const detectedEncoding = detectEncoding(languageDriver);
  const encoding =
    encodingChoice === "auto" ? detectedEncoding : encodingChoice;
  const decoder = makeDecoder(encoding);
  const asciiDecoder = makeDecoder("ascii");

  // --- Descriptores de campos (desde offset 32 hasta el terminador 0x0D) ---
  const fields: DbfField[] = [];
  let pos = 32;
  while (pos < headerSize - 1 && bytes[pos] !== 0x0d) {
    const nameBytes = bytes.subarray(pos, pos + 11);
    // El nombre termina en 0x00.
    let end = nameBytes.indexOf(0x00);
    if (end === -1) end = 11;
    const name = asciiDecoder.decode(nameBytes.subarray(0, end)).trim();
    const type = String.fromCharCode(bytes[pos + 11]);
    const length = bytes[pos + 16];
    const decimals = bytes[pos + 17];
    fields.push({ name, type, length, decimals });
    pos += 32;
  }

  // --- Registros ---
  const records: Record<string, unknown>[] = [];
  let offset = headerSize;
  for (let i = 0; i < recordCount; i++) {
    if (offset + recordSize > bytes.length) break;
    const deleted = bytes[offset] === 0x2a; // '*' = registro borrado
    let fieldPos = offset + 1;
    if (deleted) {
      offset += recordSize;
      continue;
    }
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = bytes.subarray(fieldPos, fieldPos + f.length);
      row[f.name] = decodeField(f, raw, decoder);
      fieldPos += f.length;
    }
    records.push(row);
    offset += recordSize;
  }

  return { fields, records, recordCount: records.length, encoding, detectedEncoding };
}

function decodeField(
  f: DbfField,
  raw: Uint8Array,
  decoder: TextDecoder,
): unknown {
  switch (f.type) {
    case "C":
    case "M": // memo: devolvemos el puntero/texto crudo
      return decoder.decode(raw).replace(/\u0000+$/, "").trim();
    case "N":
    case "F": {
      const s = decoder.decode(raw).trim();
      if (s === "" || s === "." || s === "-") return null;
      const n = Number(s);
      return Number.isNaN(n) ? null : n;
    }
    case "I": {
      // entero binario 4 bytes LE
      if (raw.length >= 4) {
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
        return dv.getInt32(0, true);
      }
      return null;
    }
    case "L": {
      const c = String.fromCharCode(raw[0]).toUpperCase();
      if (c === "T" || c === "Y") return true;
      if (c === "F" || c === "N") return false;
      return null;
    }
    case "D": {
      // AAAAMMDD
      const s = decoder.decode(raw).trim();
      if (/^\d{8}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      }
      return s || null;
    }
    default:
      return decoder.decode(raw).trim();
  }
}

/**
 * Normaliza texto para busqueda: minusculas, sin tildes, y la ñ -> n.
 * Asi "niño" y "nino" coinciden, "artículo" y "articulo", etc.
 */
export function normalizeText(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacriticos (incluye la tilde de ñ)
    .replace(/[^a-z0-9\s]/g, " ") // ñ ya quedo como n; resto a espacio
    .replace(/\s+/g, " ")
    .trim();
}
