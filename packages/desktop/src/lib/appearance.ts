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

  // En modo claro, los "sheen"/glass/sombras deben ser mas tenues y oscuros
  // (en vez de brillos blancos). Lo controlamos con un atributo de modo.
  document.documentElement.setAttribute("data-mode", a.mode);
  if (a.mode === "light") {
    r.setProperty("--wtm-glass", "rgba(0, 0, 0, 0.035)");
    r.setProperty("--wtm-sheen", "rgba(255, 255, 255, 0.6)");
    r.setProperty("--wtm-shadow-sm", "0 1px 2px rgba(15, 23, 42, 0.12)");
    r.setProperty("--wtm-shadow-md", "0 6px 18px rgba(15, 23, 42, 0.14)");
    r.setProperty("--wtm-shadow-lg", "0 16px 44px rgba(15, 23, 42, 0.2)");
    r.setProperty("--wtm-border-strong", shade(a.colors.border, -0.08));
  } else {
    r.setProperty("--wtm-glass", "rgba(255, 255, 255, 0.04)");
    r.setProperty("--wtm-sheen", "rgba(255, 255, 255, 0.07)");
    r.setProperty("--wtm-shadow-sm", "0 1px 2px rgba(0, 0, 0, 0.35)");
    r.setProperty("--wtm-shadow-md", "0 6px 18px rgba(0, 0, 0, 0.35)");
    r.setProperty("--wtm-shadow-lg", "0 16px 44px rgba(0, 0, 0, 0.5)");
    r.setProperty("--wtm-border-strong", shade(a.colors.border, 0.1));
  }
  document.title = a.systemName;
}

/** Aclara (+) u oscurece (-) un color hex una fraccion. */
function shade(hex: string, amount: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + 255 * amount)));
  r = adj(r);
  g = adj(g);
  b = adj(b);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
