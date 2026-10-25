import type { ModuleManifest } from "@wtm/shared";

/**
 * Modulos de catalogo que aun no tienen backend real (coming-soon) y modulos
 * de sistema que siempre estan presentes (terminal, ajustes). Aparecen en el
 * escritorio; los "coming-soon" muestran datos de ejemplo hasta que se
 * implementen como modulos reales.
 *
 * El modulo Inventario YA NO esta aqui: vive como modulo real en inventario.ts.
 */
export const PLACEHOLDER_MODULES: ModuleManifest[] = [
  {
    id: "terminal",
    name: "Terminal",
    version: "0.1.0",
    description: "Terminal del sistema con comandos estilo Linux acotados a WTM.",
    icon: "terminal",
    color: "#3f4650",
    dataScope: "shared",
    status: "available",
    category: "sistema",
  },
  {
    id: "facturacion",
    name: "Facturacion",
    version: "0.1.0",
    description: "Emision de facturas y comprobantes. Datos aislados por empresa.",
    icon: "receipt",
    color: "#3b6fb0",
    dataScope: "company",
    status: "coming-soon",
    category: "ventas",
  },
  {
    id: "ventas",
    name: "Ventas",
    version: "0.1.0",
    description: "Punto de venta y gestion de clientes.",
    icon: "shopping-cart",
    color: "#3f7d8c",
    dataScope: "company",
    status: "coming-soon",
    category: "ventas",
  },
  {
    id: "contabilidad",
    name: "Contabilidad",
    version: "0.1.0",
    description: "Libro mayor, asientos y estados financieros.",
    icon: "calculator",
    color: "#6a5c9a",
    dataScope: "company",
    status: "coming-soon",
    category: "contabilidad",
  },
  {
    id: "rrhh",
    name: "Gestion Humana",
    version: "0.1.0",
    description: "Empleados, nomina y asistencia.",
    icon: "users",
    color: "#99607d",
    dataScope: "company",
    status: "coming-soon",
    category: "rrhh",
  },
  {
    id: "reportes",
    name: "Reportes",
    version: "0.1.0",
    description: "Tableros e informes sobre todos los modulos.",
    icon: "bar-chart",
    color: "#a05a52",
    dataScope: "company",
    status: "coming-soon",
    category: "reportes",
  },
  {
    id: "ajustes",
    name: "Ajustes",
    version: "0.1.0",
    description: "Usuarios, empresas, permisos y configuracion del sistema.",
    icon: "settings",
    color: "#5b636e",
    dataScope: "shared",
    status: "coming-soon",
    category: "sistema",
  },
  {
    id: "actualizaciones",
    name: "Actualizaciones",
    version: "0.1.0",
    description: "Actualizar el sistema desde GitHub y revertir versiones.",
    icon: "refresh",
    color: "#3f6b55",
    dataScope: "shared",
    status: "available",
    category: "sistema",
  },
];
