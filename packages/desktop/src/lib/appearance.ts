import type { Appearance } from "@wtm/shared";
import { DEFAULT_APPEARANCE } from "@wtm/shared";
import { getServerUrl } from "./config";

/**
 * Descarga la apariencia del core y la aplica a las variables CSS --wtm-*.
 * Como toda la estetica se define con esas variables, cambiar el tema en el
 * core se refleja en el cliente sin reinstalar nada.
 */
export async function loadAppearance(): Promise<Appearance> {
  try {
    const res = await fetch(`${getServerUrl()}/api/appearance`);
    const body = await res.json();
    if (body.ok) return body.data as Appearance;
  } catch {
    /* sin conexion: usamos el default */
  }
  return DEFAULT_APPEARANCE;
}

export function applyAppearance(a: Appearance): void {
  const r = document.documentElement.style;
  r.setProperty("--wtm-bg", a.colors.bg);
  r.setProperty("--wtm-bg-2", a.colors.bg2);
  r.setProperty("--wtm-surface", a.colors.surface);
  r.setProperty("--wtm-surface-solid", a.colors.surfaceSolid);
  r.setProperty("--wtm-border", a.colors.border);
  // border-strong se deriva del border para los relieves Aero.
  r.setProperty("--wtm-border-strong", a.colors.border);
  r.setProperty("--wtm-text", a.colors.text);
  r.setProperty("--wtm-text-dim", a.colors.textDim);
  r.setProperty("--wtm-accent", a.colors.accent);
  r.setProperty("--wtm-accent-2", a.colors.accent2);
  r.setProperty("--wtm-danger", a.colors.danger);
  r.setProperty("--wtm-radius", `${a.radius}px`);
  r.setProperty("--wtm-taskbar-h", `${a.taskbarHeight}px`);
  document.title = a.systemName;
}
