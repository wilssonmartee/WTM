// Contratos compartidos entre el core (servidor) y el desktop (cliente).
// Mantener este paquete libre de dependencias de runtime: solo tipos y constantes.

export const WTM_VERSION = "0.1.0";

/** Rol global de un usuario dentro del sistema. */
export type GlobalRole = "superadmin" | "admin" | "user";

/** Representa una empresa (tenant) dentro de WTM. */
export interface Company {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

/** Usuario del sistema. Un usuario puede pertenecer a varias empresas. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  globalRole: GlobalRole;
  createdAt: string;
}

/** Pertenencia de un usuario a una empresa, con su rol dentro de ella. */
export interface Membership {
  userId: string;
  companyId: string;
  role: "owner" | "manager" | "member";
}

/** Usuario autenticado tal como lo consume el cliente. */
export interface AuthSession {
  token: string;
  user: User;
  companies: Company[];
}

/** Estrategia de datos que declara un modulo. */
export type ModuleDataScope = "company" | "shared";

/** Manifiesto de un modulo instalable (como un paquete). */
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Icono (nombre de un icono conocido en el cliente). */
  icon: string;
  /** Color de acento para la app en el escritorio. */
  color: string;
  /**
   * Alcance de datos del modulo:
   * - "company": los datos estan aislados por empresa.
   * - "shared": los datos se comparten entre las empresas del servidor.
   */
  dataScope: ModuleDataScope;
  /** Si el modulo esta disponible/funcional o es un placeholder visual. */
  status: "available" | "coming-soon";
  /** Categoria para agrupar en el menu del escritorio. */
  category: ModuleCategory;
  /** Ids de otros modulos que este requiere para funcionar. */
  dependencies?: string[];
}

/** Manifiesto + estado de instalacion, tal como lo ve el cliente. */
export interface ModuleInfo extends ModuleManifest {
  /** Si el modulo esta instalado en este servidor. */
  installed: boolean;
  /** Version instalada (si aplica). */
  installedVersion?: string;
}

export type ModuleCategory =
  | "ventas"
  | "inventario"
  | "contabilidad"
  | "rrhh"
  | "reportes"
  | "sistema";

export const MODULE_CATEGORY_LABELS: Record<ModuleCategory, string> = {
  ventas: "Ventas",
  inventario: "Inventario",
  contabilidad: "Contabilidad",
  rrhh: "Gestion Humana",
  reportes: "Reportes",
  sistema: "Sistema",
};

/** Respuesta estandar de la API. */
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: string;
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** Resultado de ejecutar un comando en la terminal del sistema. */
export interface TerminalResult {
  cwd: string;
  lines: TerminalLine[];
}
export interface TerminalLine {
  kind: "stdout" | "stderr" | "info";
  text: string;
}

export const DEFAULT_CORE_PORT = 4000;

/**
 * Apariencia del sistema. Vive en el core y el escritorio la descarga al
 * cargar, por lo que los cambios esteticos NO requieren reinstalar el cliente.
 * Los valores de color se aplican sobre las variables CSS --wtm-*.
 */
export interface Appearance {
  /** Nombre visible del sistema (login, titulos). */
  systemName: string;
  /** Texto corto bajo el nombre (eslogan). */
  tagline: string;
  /** Iniciales o texto del logo. */
  logoText: string;
  /** Tema base. */
  mode: "dark" | "light";
  colors: {
    bg: string;
    bg2: string;
    surface: string;
    surfaceSolid: string;
    border: string;
    text: string;
    textDim: string;
    accent: string;
    accent2: string;
    danger: string;
  };
  /** Radio de bordes en px. */
  radius: number;
  /** Alto de la barra de tareas en px. */
  taskbarHeight: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  systemName: "WTM",
  tagline: "Sistema de gestion empresarial",
  logoText: "W",
  mode: "dark",
  colors: {
    // Paleta sobria tipo estacion de trabajo: grises neutros y un unico
    // azul discreto como acento. Sin degradados ni translucidos.
    bg: "#16181d",
    bg2: "#1b1e24",
    surface: "#1f232b",
    surfaceSolid: "#23272f",
    border: "#30353e",
    text: "#d6d9df",
    textDim: "#8b919c",
    accent: "#3b82f6",
    accent2: "#2563eb",
    danger: "#dc2626",
  },
  radius: 6,
  taskbarHeight: 40,
};

// ===================================================================
//  Autoactualizacion por GitHub
// ===================================================================

/** Configuracion del origen de actualizaciones (se guarda en settings). */
export interface UpdateConfig {
  /** Repositorio en formato owner/repo (ej. "miusuario/wtm"). */
  repo: string;
  /** Rama a seguir (ej. "main"). */
  branch: string;
  /** Si el sistema revisa y aplica commits nuevos automaticamente. */
  autoUpdate: boolean;
  /** Minutos entre revisiones cuando autoUpdate esta activo. */
  checkIntervalMin: number;
  /** Indica si hay un token configurado (nunca devolvemos el token en si). */
  hasToken: boolean;
}

export const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  repo: "",
  branch: "main",
  autoUpdate: false,
  checkIntervalMin: 15,
  hasToken: false,
};

/** Un commit del historial, para la vista de reversion. */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  /** Si es el commit en el que esta el sistema ahora. */
  current: boolean;
}

/** Estado actual del subsistema de actualizaciones. */
export interface UpdateStatus {
  /** Si la carpeta es un repositorio git valido. */
  isGitRepo: boolean;
  /** Config actual. */
  config: UpdateConfig;
  /** Commit actual (HEAD). */
  currentCommit: CommitInfo | null;
  /** Commits nuevos disponibles en remoto (si se detectaron). */
  behind: number;
  /** Ultima vez que se reviso el remoto (ISO) o null. */
  lastChecked: string | null;
  /** Ultima operacion/alerta para mostrar al usuario. */
  lastMessage: UpdateMessage | null;
  /** Si hay una operacion en curso (update/rollback). */
  busy: boolean;
  /** Fase actual de la operacion en curso. */
  phase: UpdatePhase;
}

export interface UpdateMessage {
  level: "info" | "success" | "error";
  text: string;
  at: string;
}

/** Entrada del registro de auditoria de actualizaciones. */
export interface UpdateLogEntry {
  at: string;
  action: "check" | "update" | "rollback" | "revert-failed-build";
  fromCommit: string | null;
  toCommit: string | null;
  ok: boolean;
  detail: string;
}

/** Mensaje que el core envia por WebSocket cuando cambia la version. */
export interface SystemReloadEvent {
  type: "system-reload";
  reason: string;
}

/** Fases de una operacion de actualizacion/reversion. */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "downloading"
  | "building"
  | "reverting"
  | "restarting"
  | "done"
  | "error";

/** Evento de progreso de actualizacion que el core emite por WebSocket. */
export interface UpdateProgressEvent {
  type: "update-progress";
  phase: UpdatePhase;
  /** Linea de log legible para mostrar en vivo. */
  line: string;
  level: "info" | "success" | "error";
  at: string;
  /** Estado completo actualizado (para refrescar la UI sin pedirlo). */
  status?: UpdateStatus;
}
