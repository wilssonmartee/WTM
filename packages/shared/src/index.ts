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

/** Comodin que representa "todas las empresas" (incluidas las futuras). */
export const ALL_COMPANIES = "*";

/** Nivel de autoridad dentro de una app: 1 (mas bajo) a 10 (mas alto). */
export type AppLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Permiso de un usuario sobre una app, en una empresa concreta o en todas.
 * El nivel gobierna que puede ver/hacer dentro del modulo (los campos del
 * modulo condicionan su visibilidad por nivel).
 */
export interface Permission {
  userId: string;
  moduleId: string;
  /** Id de empresa, o ALL_COMPANIES ("*") para todas. */
  companyId: string;
  level: AppLevel;
}

/**
 * Permisos efectivos del usuario autenticado, para que el cliente sepa que
 * puede abrir y con que nivel en cada empresa. Mapa:
 *   moduleId -> { companyId|"*": level }
 */
export type EffectivePermissions = Record<string, Record<string, AppLevel>>;

/** Usuario tal como lo ve el panel de administracion (con membresias y permisos). */
export interface AdminUser extends User {
  companyIds: string[];
  permissions: Permission[];
}

/** Usuario autenticado tal como lo consume el cliente. */
export interface AuthSession {
  token: string;
  user: User;
  companies: Company[];
  permissions: EffectivePermissions;
}

/**
 * Resuelve el nivel efectivo de un usuario para un modulo en una empresa.
 * Devuelve 0 si no tiene acceso. Un permiso para la empresa concreta gana
 * sobre el comodin; si solo existe el comodin, ese aplica.
 */
export function resolveLevel(
  perms: EffectivePermissions,
  moduleId: string,
  companyId: string | null,
): number {
  // Comodin de modulo "*" = acceso total (admin/superadmin).
  const wildModule = perms["*"];
  if (wildModule && wildModule[ALL_COMPANIES] != null) {
    return wildModule[ALL_COMPANIES];
  }
  const forModule = perms[moduleId];
  if (!forModule) return 0;
  if (companyId && forModule[companyId] != null) return forModule[companyId];
  if (forModule[ALL_COMPANIES] != null) return forModule[ALL_COMPANIES];
  return 0;
}

/** Atajo: el usuario tiene al menos el nivel n para el modulo en la empresa. */
export function hasLevel(
  perms: EffectivePermissions,
  moduleId: string,
  companyId: string | null,
  n: number,
): boolean {
  return resolveLevel(perms, moduleId, companyId) >= n;
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
  /**
   * Nivel minimo (1-10) para abrir la app. Por defecto 1: basta con tener un
   * permiso. Un modulo sensible puede exigir mas para abrirse siquiera.
   */
  minLevel?: AppLevel;
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
  // Estetica inspirada en Windows 7 (Aero): tema claro con cristal azul.
  mode: "light",
  colors: {
    bg: "#5b89c4",
    bg2: "#3f6aa0",
    surface: "#f1f5fb",
    surfaceSolid: "#ffffff",
    border: "#a9c2e0",
    text: "#1b2430",
    textDim: "#5a6677",
    accent: "#2f8fe0",
    accent2: "#1f6fc0",
    danger: "#d64840",
  },
  radius: 8,
  taskbarHeight: 44,
};

/** Presets de color para modo oscuro y claro. El acento se aplica aparte. */
export const COLOR_PRESETS: Record<"dark" | "light", Appearance["colors"]> = {
  light: {
    bg: "#5b89c4",
    bg2: "#3f6aa0",
    surface: "#f1f5fb",
    surfaceSolid: "#ffffff",
    border: "#a9c2e0",
    text: "#1b2430",
    textDim: "#5a6677",
    accent: "#2f8fe0",
    accent2: "#1f6fc0",
    danger: "#d64840",
  },
  dark: {
    bg: "#1a2740",
    bg2: "#0f1826",
    surface: "#262d38",
    surfaceSolid: "#2a313c",
    border: "#3a4451",
    text: "#e3e9f2",
    textDim: "#9fb0c4",
    accent: "#3b9af0",
    accent2: "#2579d0",
    danger: "#e0564f",
  },
};

/** Opciones de color de acento (nombre + color base). */
export const ACCENT_OPTIONS: { name: string; accent: string; accent2: string }[] =
  [
    { name: "Azul", accent: "#3b82f6", accent2: "#2563eb" },
    { name: "Indigo", accent: "#6366f1", accent2: "#4f46e5" },
    { name: "Verde", accent: "#10b981", accent2: "#059669" },
    { name: "Teal", accent: "#14b8a6", accent2: "#0d9488" },
    { name: "Ambar", accent: "#f59e0b", accent2: "#d97706" },
    { name: "Rojo", accent: "#ef4444", accent2: "#dc2626" },
    { name: "Rosa", accent: "#ec4899", accent2: "#db2777" },
    { name: "Violeta", accent: "#8b5cf6", accent2: "#7c3aed" },
  ];

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

// ===================================================================
//  Estado del escritorio por usuario (ventanas abiertas)
// ===================================================================

/** Una ventana guardada en el layout del usuario. */
export interface SavedWindow {
  moduleId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  minimized: boolean;
}

/** Geometria recordada de un modulo (aunque este cerrado). */
export interface SavedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Layout del escritorio de un usuario (se guarda en el servidor). */
export interface DesktopLayout {
  /** Ventanas actualmente abiertas (para reabrirlas al entrar). */
  windows: SavedWindow[];
  /**
   * Ultima geometria por modulo, incluso si se cerro. Al reabrir un modulo
   * se usa esta para restaurar tamano/posicion.
   */
  geometry?: Record<string, SavedGeometry>;
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
