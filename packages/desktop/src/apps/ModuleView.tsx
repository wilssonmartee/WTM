import type { ModuleManifest } from "@wtm/shared";
import { MODULE_CATEGORY_LABELS } from "@wtm/shared";
import { Icon } from "../components/Icon";
import { useAuth } from "../state/auth";

/**
 * Vista generica de un modulo. Para los modulos aun no implementados muestra
 * un encabezado real, barra de herramientas, metricas y una tabla de ejemplo,
 * para que el sistema se vea como software real aunque la logica no exista.
 */
export function ModuleView({ module }: { module: ModuleManifest }) {
  const { companies, activeCompanyId } = useAuth();
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const demo = DEMO_DATA[module.id];

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

      <div className="wtm-toolbar">
        <button className="wtm-tool wtm-tool--primary">Nuevo</button>
        <button className="wtm-tool">Importar</button>
        <button className="wtm-tool">Exportar</button>
        <div style={{ flex: 1 }} />
        {activeCompany && (
          <span className="wtm-chip">{activeCompany.name}</span>
        )}
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
        </div>

        {demo ? (
          <>
            <div className="wtm-cards">
              {demo.metrics.map((m, i) => (
                <div className="wtm-card" key={i}>
                  <div className="wtm-card__value">{m.value}</div>
                  <div className="wtm-card__label">{m.label}</div>
                </div>
              ))}
            </div>

            <table className="wtm-table">
              <thead>
                <tr>
                  {demo.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {demo.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="wtm-notice">
            <Icon name="settings" size={16} />
            Modulo de sistema. Su configuracion llegara en una proxima version.
          </div>
        )}

        <div className="wtm-notice">
          <Icon name="boxes" size={16} />
          Datos de ejemplo. La funcionalidad completa llegara como paquete
          instalable desde el registro de modulos.
        </div>
      </div>
    </div>
  );
}

interface Demo {
  metrics: { value: string; label: string }[];
  columns: string[];
  rows: string[][];
}

const DEMO_DATA: Record<string, Demo> = {
  facturacion: {
    metrics: [
      { value: "128", label: "Facturas del mes" },
      { value: "$ 42,300", label: "Facturado" },
      { value: "6", label: "Pendientes" },
    ],
    columns: ["Numero", "Cliente", "Fecha", "Total", "Estado"],
    rows: [
      ["F-001042", "Comercial Andes", "24/10/2026", "$ 1,250.00", "Pagada"],
      ["F-001041", "Distribuidora Sur", "23/10/2026", "$ 860.00", "Pendiente"],
      ["F-001040", "Ferreteria Lopez", "22/10/2026", "$ 2,430.00", "Pagada"],
      ["F-001039", "Servicios RM", "21/10/2026", "$ 540.00", "Anulada"],
    ],
  },
  ventas: {
    metrics: [
      { value: "312", label: "Ventas del mes" },
      { value: "$ 58,100", label: "Ingresos" },
      { value: "47", label: "Clientes" },
    ],
    columns: ["Ticket", "Cliente", "Items", "Total", "Vendedor"],
    rows: [
      ["V-9021", "Mostrador", "3", "$ 145.00", "Ana"],
      ["V-9020", "Comercial Andes", "12", "$ 1,980.00", "Luis"],
      ["V-9019", "Mostrador", "1", "$ 32.00", "Ana"],
      ["V-9018", "Distribuidora Sur", "7", "$ 760.00", "Carlos"],
    ],
  },
  inventario: {
    metrics: [
      { value: "1,204", label: "Productos" },
      { value: "18", label: "Bajo stock" },
      { value: "3", label: "Almacenes" },
    ],
    columns: ["SKU", "Producto", "Almacen", "Stock", "Estado"],
    rows: [
      ["SKU-1001", "Tornillo 1/4", "Central", "5,200", "OK"],
      ["SKU-1002", "Cable 2mm (m)", "Central", "12", "Bajo"],
      ["SKU-1003", "Pintura blanca 1L", "Sucursal 1", "340", "OK"],
      ["SKU-1004", "Broca 6mm", "Sucursal 2", "0", "Agotado"],
    ],
  },
  contabilidad: {
    metrics: [
      { value: "$ 210,000", label: "Activos" },
      { value: "$ 86,000", label: "Pasivos" },
      { value: "124", label: "Asientos" },
    ],
    columns: ["Asiento", "Fecha", "Cuenta", "Debe", "Haber"],
    rows: [
      ["A-0312", "24/10/2026", "Caja", "$ 1,250.00", "—"],
      ["A-0312", "24/10/2026", "Ventas", "—", "$ 1,250.00"],
      ["A-0311", "23/10/2026", "Bancos", "$ 5,000.00", "—"],
      ["A-0311", "23/10/2026", "Clientes", "—", "$ 5,000.00"],
    ],
  },
  rrhh: {
    metrics: [
      { value: "34", label: "Empleados" },
      { value: "2", label: "Vacantes" },
      { value: "$ 51,000", label: "Nomina mensual" },
    ],
    columns: ["Codigo", "Empleado", "Area", "Cargo", "Estado"],
    rows: [
      ["E-021", "Ana Torres", "Ventas", "Vendedora", "Activo"],
      ["E-020", "Luis Diaz", "Ventas", "Vendedor", "Activo"],
      ["E-019", "Marta Ruiz", "Contabilidad", "Analista", "Vacaciones"],
      ["E-018", "Jorge Pena", "Almacen", "Operario", "Activo"],
    ],
  },
  reportes: {
    metrics: [
      { value: "12", label: "Tableros" },
      { value: "48", label: "Informes" },
      { value: "7", label: "Programados" },
    ],
    columns: ["Informe", "Modulo", "Periodo", "Formato", "Ultima ejecucion"],
    rows: [
      ["Ventas por mes", "Ventas", "Mensual", "PDF", "24/10/2026"],
      ["Stock critico", "Inventario", "Diario", "Excel", "24/10/2026"],
      ["Estado de resultados", "Contabilidad", "Mensual", "PDF", "01/10/2026"],
    ],
  },
};
