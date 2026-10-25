import { db } from "./db.js";
import { DEFAULT_APPEARANCE, type Appearance } from "@wtm/shared";

/**
 * Lectura/escritura de la apariencia del sistema.
 *
 * Se guarda como JSON en la tabla settings (clave "appearance"). Si no existe,
 * se devuelven los valores por defecto. Cualquier campo ausente se completa
 * con el default, para que agregar campos nuevos no rompa instalaciones viejas.
 */

const KEY = "appearance";

export function getAppearance(): Appearance {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_APPEARANCE;
  try {
    const stored = JSON.parse(row.value) as Partial<Appearance>;
    return {
      ...DEFAULT_APPEARANCE,
      ...stored,
      colors: { ...DEFAULT_APPEARANCE.colors, ...(stored.colors ?? {}) },
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function setAppearance(partial: Partial<Appearance>): Appearance {
  const current = getAppearance();
  const next: Appearance = {
    ...current,
    ...partial,
    colors: { ...current.colors, ...(partial.colors ?? {}) },
  };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY, JSON.stringify(next));
  return next;
}
