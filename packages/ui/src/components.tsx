import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/**
 * Kit de UI compartido de WTM (@wtm/ui).
 *
 * Todos los modulos usan estos componentes en vez de escribir HTML + clases a
 * mano. Asi, al cambiar el tema del layout, TODOS los modulos cambian solos, y
 * desarrollar un modulo se reduce a "componer con piezas".
 *
 * Los estilos reales viven en el CSS global del escritorio (clases wtm-*),
 * que se basan en las variables --wtm-* del tema activo. Este paquete solo
 * aporta la API de componentes, sin estilos propios.
 */

// --- Boton ---
export type ButtonVariant = "primary" | "default" | "ghost" | "danger";
export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`ui-btn ui-btn--${variant} ${className}`.trim()}
    />
  );
}

// --- Campo con etiqueta ---
export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="ui-field">
      {label && <span className="ui-field__label">{label}</span>}
      {children}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </label>
  );
}

// --- Input ---
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${className}`.trim()} />;
}

// --- Select ---
export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`ui-input ui-select ${className}`.trim()}>
      {children}
    </select>
  );
}

// --- Barra de herramientas ---
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar">{children}</div>;
}
export function Spacer() {
  return <div style={{ flex: 1 }} />;
}

// --- Tarjeta de metrica ---
export function StatCard({
  value,
  label,
  accent,
}: {
  value: ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={`ui-card ${accent ? "ui-card--accent" : ""}`.trim()}>
      <div className="ui-card__value">{value}</div>
      <div className="ui-card__label">{label}</div>
    </div>
  );
}
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="ui-cards">{children}</div>;
}

// --- Etiqueta de estado ---
export function Tag({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  return <span className={`ui-tag ui-tag--${tone}`}>{children}</span>;
}

// --- Aviso ---
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "error";
}) {
  return <div className={`ui-notice ui-notice--${tone}`}>{children}</div>;
}

// --- Tabla de datos ---
export function Table({
  columns,
  children,
}: {
  columns: ReactNode[];
  children: ReactNode;
}) {
  return (
    <table className="ui-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// --- Encabezado de modulo ---
export function ModuleHeader({
  icon,
  color,
  title,
  subtitle,
}: {
  icon?: ReactNode;
  color?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="ui-module__head">
      {icon && (
        <div className="ui-module__icon" style={{ background: color }}>
          {icon}
        </div>
      )}
      <div className="ui-module__title">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * Contenedor de un modulo. Envuelve el contenido con data-module="<id>" para
 * poder dar estilos propios por modulo, y permite sobrescribir variables de
 * tema SOLO dentro del modulo (themeOverride).
 */
export function ModuleShell({
  moduleId,
  themeOverride,
  children,
}: {
  moduleId: string;
  themeOverride?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className="ui-module"
      data-module={moduleId}
      style={themeOverride}
    >
      {children}
    </div>
  );
}

export function ModuleBody({ children }: { children: ReactNode }) {
  return <div className="ui-module__body">{children}</div>;
}
