import type { ModuleManifest } from "@wtm/shared";

/**
 * Modulos de SISTEMA que siempre estan presentes (no se instalan ni se
 * desinstalan): terminal, ajustes, actualizaciones y el estudio de modulos.
 * Aparecen en el escritorio y su UI vive en el frontend.
 *
 * Ya no hay modulos "coming-soon": los modulos de negocio se crean con el
 * Estudio de modulos o viven como modulos reales (inventario, articulos).
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
    id: "ajustes",
    name: "Ajustes",
    version: "0.1.0",
    description: "Apariencia, usuarios, empresas y configuracion del sistema.",
    icon: "settings",
    color: "#5b636e",
    dataScope: "shared",
    status: "available",
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
  {
    id: "estudio",
    name: "Estudio de modulos",
    version: "0.1.0",
    description:
      "Crea y edita modulos del sistema: define datos, formularios y logica sin salir de WTM.",
    icon: "code",
    color: "#7a4fb0",
    dataScope: "shared",
    status: "available",
    category: "sistema",
  },
];
