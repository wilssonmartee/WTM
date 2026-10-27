import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Almacen de ARCHIVOS de los modulos dinamicos (estilo WordPress: cada modulo
 * es una carpeta con archivos reales que se pueden editar desde la interfaz).
 *
 * Estructura en disco (bajo data/modules/<id>/):
 *   manifest.json   metadatos del modulo (id, nombre, icono, color, ...)
 *   schema.json     definicion de campos de datos (tabla + formularios)
 *   logic.js        hooks opcionales en JavaScript (validar, calcular, eventos)
 *   README.md       notas del autor
 *   (y cualquier archivo extra que el usuario cree)
 *
 * El motor (dynamic.ts) lee manifest.json + schema.json para generar la tabla
 * y el CRUD; logic.js se ejecuta en un entorno aislado para la logica a medida.
 *
 * Toda ruta se resuelve DENTRO de la carpeta del modulo: imposible escapar con
 * "..", rutas absolutas, etc. (proteccion contra path traversal).
 */

const IDENT = /^[a-z][a-z0-9_]{1,30}$/;

export function safeModuleId(id: string): boolean {
  return IDENT.test(id);
}

/** Carpeta raiz donde viven todos los modulos dinamicos. */
export function modulesRoot(): string {
  const dir = path.join(config.dataDir, "modules");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Carpeta de un modulo concreto (no escapa si el id es valido). */
export function moduleDir(id: string): string {
  if (!safeModuleId(id)) throw new Error("Identificador de modulo invalido");
  const dir = path.join(modulesRoot(), id);
  return dir;
}

/** Existe la carpeta del modulo (tiene al menos manifest.json). */
export function moduleExists(id: string): boolean {
  if (!safeModuleId(id)) return false;
  return fs.existsSync(path.join(moduleDir(id), "manifest.json"));
}

/** Lista los ids de modulos presentes en disco. */
export function listModuleDirs(): string[] {
  const root = modulesRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        safeModuleId(e.name) &&
        fs.existsSync(path.join(root, e.name, "manifest.json")),
    )
    .map((e) => e.name);
}

/**
 * Resuelve una ruta de archivo relativa DENTRO de la carpeta del modulo.
 * Rechaza cualquier intento de salir de la carpeta (path traversal).
 */
export function resolveFile(id: string, relPath: string): string {
  const base = moduleDir(id);
  // Normalizamos y prohibimos rutas absolutas o con '..' que escapen.
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(base, clean);
  const rel = path.relative(base, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Ruta fuera del modulo");
  }
  return full;
}

export interface FileEntry {
  path: string; // ruta relativa dentro del modulo
  size: number;
  isDir: boolean;
}

/** Lista TODOS los archivos del modulo (recursivo, rutas relativas). */
export function listFiles(id: string): FileEntry[] {
  const base = moduleDir(id);
  if (!fs.existsSync(base)) return [];
  const out: FileEntry[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(base, abs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        out.push({ path: rel, size: 0, isDir: true });
        walk(abs);
      } else {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {
          /* ignore */
        }
        out.push({ path: rel, size, isDir: false });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFileText(id: string, relPath: string): string {
  return fs.readFileSync(resolveFile(id, relPath), "utf8");
}

export function writeFileText(id: string, relPath: string, text: string): void {
  const full = resolveFile(id, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, "utf8");
}

export function deleteFile(id: string, relPath: string): void {
  const full = resolveFile(id, relPath);
  if (fs.existsSync(full)) {
    const st = fs.statSync(full);
    if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    else fs.unlinkSync(full);
  }
}

/** Borra la carpeta completa del modulo. */
export function removeModuleDir(id: string): void {
  if (!safeModuleId(id)) return;
  fs.rmSync(moduleDir(id), { recursive: true, force: true });
}

/** Lee y parsea un JSON del modulo; devuelve null si no existe o es invalido. */
export function readJson<T>(id: string, relPath: string): T | null {
  try {
    return JSON.parse(readFileText(id, relPath)) as T;
  } catch {
    return null;
  }
}
