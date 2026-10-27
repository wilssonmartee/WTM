import type { ModuleManifest } from "@wtm/shared";
import { MODULE_CATEGORY_LABELS } from "@wtm/shared";
import { Icon } from "../components/Icon";
import { useAuth } from "../state/auth";

/**
 * Vista generica de respaldo para un modulo sin UI propia. Muestra su ficha
 * (nombre, version, alcance). Los modulos creados con el Estudio usan su propia
 * vista dinamica; este fallback es para casos sin interfaz dedicada.
 */
export function ModuleView({ module }: { module: ModuleManifest }) {
  const { companies, activeCompanyId } = useAuth();
  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  return (
    <div className="wtm-module">
      <div className="wtm-module__head">
        <div className="wtm-module__icon" style={{ background: module.color }}>
          <Icon name={module.icon} size={20} />
        </div>
        <div className="wtm-module__title">
          <h2>{module.name}</h2>
          <p>{module.description}</p>
        </div>
      </div>

      <div className="wtm-module__content">
        <div className="wtm-chips">
          <span className="wtm-chip">v{module.version}</span>
          <span className="wtm-chip">
            {MODULE_CATEGORY_LABELS[module.category]}
          </span>
          <span className="wtm-chip">
            {module.dataScope === "company"
              ? "Datos por empresa"
              : "Datos compartidos"}
          </span>
          {activeCompany && (
            <span className="wtm-chip">{activeCompany.name}</span>
          )}
        </div>

        <div className="wtm-notice">
          <Icon name="settings" size={16} />
          Este modulo no tiene una interfaz dedicada.
        </div>
      </div>
    </div>
  );
}
