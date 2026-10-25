import { useEffect, useState } from "react";
import type { Appearance, ModuleManifest } from "@wtm/shared";
import { ACCENT_OPTIONS, COLOR_PRESETS } from "@wtm/shared";
import {
  Button,
  Field,
  Input,
  ModuleBody,
  ModuleHeader,
  ModuleShell,
  Notice,
  Toolbar,
  Spacer,
} from "@wtm/ui";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Icon";

/**
 * Ajustes del sistema. Por ahora: apariencia (modo claro/oscuro, color de
 * acento, nombre). Solo el superadmin puede cambiarla. Los cambios se aplican
 * en vivo (refrescan el tema de todo el sistema).
 */
export function Ajustes({ module }: { module: ModuleManifest }) {
  const { user, appearance, refreshAppearance } = useAuth();
  const isAdmin = user?.globalRole === "superadmin";
  const [draft, setDraft] = useState<Appearance>(appearance);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(appearance), [appearance]);

  function setMode(mode: "dark" | "light") {
    // Al cambiar de modo, tomamos el preset, pero conservamos el acento actual.
    const preset = COLOR_PRESETS[mode];
    setDraft((d) => ({
      ...d,
      mode,
      colors: {
        ...preset,
        accent: d.colors.accent,
        accent2: d.colors.accent2,
      },
    }));
  }

  function setAccent(accent: string, accent2: string) {
    setDraft((d) => ({ ...d, colors: { ...d.colors, accent, accent2 } }));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await api.setAppearance(draft);
      await refreshAppearance();
      setMsg("Apariencia guardada y aplicada.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleShell moduleId="ajustes">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Ajustes"
        subtitle="Apariencia y configuracion del sistema"
      />

      <Toolbar>
        <strong style={{ fontSize: 13 }}>Apariencia</strong>
        <Spacer />
        {isAdmin && (
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        )}
      </Toolbar>

      <ModuleBody>
        {!isAdmin && (
          <Notice>
            Solo un superadministrador puede cambiar la apariencia del sistema.
          </Notice>
        )}
        {msg && <Notice tone="success">{msg}</Notice>}

        {/* Modo claro / oscuro */}
        <h3 style={sectionStyle}>Tema</h3>
        <div style={{ display: "flex", gap: 10 }}>
          {(["dark", "light"] as const).map((mode) => (
            <button
              key={mode}
              disabled={!isAdmin}
              onClick={() => setMode(mode)}
              style={{
                ...swatchCardStyle,
                borderColor:
                  draft.mode === mode
                    ? "var(--wtm-accent)"
                    : "var(--wtm-border)",
                background: COLOR_PRESETS[mode].surface,
                color: COLOR_PRESETS[mode].text,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: 36,
                  borderRadius: 6,
                  marginBottom: 8,
                  background: COLOR_PRESETS[mode].bg,
                  border: `1px solid ${COLOR_PRESETS[mode].border}`,
                }}
              />
              {mode === "dark" ? "Oscuro" : "Claro"}
            </button>
          ))}
        </div>

        {/* Color de acento */}
        <h3 style={sectionStyle}>Color de acento</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ACCENT_OPTIONS.map((opt) => (
            <button
              key={opt.accent}
              disabled={!isAdmin}
              onClick={() => setAccent(opt.accent, opt.accent2)}
              title={opt.name}
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                cursor: isAdmin ? "pointer" : "default",
                border:
                  draft.colors.accent === opt.accent
                    ? "3px solid var(--wtm-text)"
                    : "1px solid var(--wtm-border)",
                background: `linear-gradient(180deg, ${opt.accent}, ${opt.accent2})`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
              }}
            />
          ))}
        </div>

        {/* Nombre del sistema */}
        <h3 style={sectionStyle}>Identidad</h3>
        <div style={{ maxWidth: 360 }}>
          <Field label="Nombre del sistema">
            <Input
              value={draft.systemName}
              disabled={!isAdmin}
              onChange={(e) =>
                setDraft({ ...draft, systemName: e.target.value })
              }
            />
          </Field>
          <Field label="Eslogan">
            <Input
              value={draft.tagline}
              disabled={!isAdmin}
              onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
            />
          </Field>
        </div>
      </ModuleBody>
    </ModuleShell>
  );
}

const sectionStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--wtm-text-dim)",
  margin: "20px 0 10px",
};
const swatchCardStyle: React.CSSProperties = {
  width: 130,
  padding: 12,
  borderRadius: 10,
  border: "2px solid var(--wtm-border)",
  textAlign: "center",
  fontSize: 13,
  cursor: "pointer",
};
