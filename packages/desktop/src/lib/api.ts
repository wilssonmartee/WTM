import type {
  ApiResponse,
  Appearance,
  AuthSession,
  Company,
  CommitInfo,
  DesktopLayout,
  ModuleInfo,
  UpdateConfig,
  UpdateLogEntry,
  UpdateStatus,
  User,
} from "@wtm/shared";
import { getServerUrl } from "./config";

const TOKEN_KEY = "wtm.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Empresa activa: se envia en cada peticion para que los modulos con
// dataScope "company" sepan sobre que empresa operar.
let activeCompanyId: string | null = null;
export function setActiveCompanyHeader(id: string | null): void {
  activeCompanyId = id;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${getServerUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(activeCompanyId ? { "X-WTM-Company": activeCompanyId } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

export const api = {
  async health(): Promise<{ status: string; version: string }> {
    return request("/api/health");
  },
  async login(username: string, password: string): Promise<AuthSession> {
    const data = await request<AuthSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    return data;
  },
  async me(): Promise<{ user: User; companies: Company[] }> {
    return request("/api/auth/me");
  },
  async modules(): Promise<ModuleInfo[]> {
    return request("/api/modules");
  },
  async installModule(id: string): Promise<ModuleInfo[]> {
    return request(`/api/modules/${id}/install`, { method: "POST" });
  },
  async uninstallModule(id: string, purge = false): Promise<ModuleInfo[]> {
    return request(`/api/modules/${id}/uninstall?purge=${purge}`, {
      method: "POST",
    });
  },
  /** Llamada generica a la API de un modulo instalado: /api/m/<id>/<path>. */
  async moduleCall<T>(
    moduleId: string,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    return request<T>(`/api/m/${moduleId}${path}`, options);
  },

  // --- Actualizaciones (GitHub) ---
  async updateStatus(): Promise<UpdateStatus> {
    return request("/api/update/status");
  },
  async updateHistory(): Promise<CommitInfo[]> {
    return request("/api/update/history");
  },
  async updateLog(): Promise<UpdateLogEntry[]> {
    return request("/api/update/log");
  },
  async setUpdateConfig(
    cfg: Partial<UpdateConfig> & { token?: string | null },
  ): Promise<UpdateConfig> {
    return request("/api/update/config", {
      method: "PUT",
      body: JSON.stringify(cfg),
    });
  },
  async updateCheck(): Promise<UpdateStatus> {
    return request("/api/update/check", { method: "POST" });
  },
  async updateApply(): Promise<UpdateStatus> {
    return request("/api/update/apply", { method: "POST" });
  },
  async updateRollback(hash: string): Promise<UpdateStatus> {
    return request("/api/update/rollback", {
      method: "POST",
      body: JSON.stringify({ hash }),
    });
  },

  // --- Apariencia (tema del sistema) ---
  async getAppearance(): Promise<Appearance> {
    return request("/api/appearance");
  },
  async setAppearance(partial: Partial<Appearance>): Promise<Appearance> {
    return request("/api/appearance", {
      method: "PUT",
      body: JSON.stringify(partial),
    });
  },

  // --- Layout del escritorio (por usuario, en el servidor) ---
  async getLayout(): Promise<DesktopLayout> {
    return request("/api/layout");
  },
  async saveLayout(layout: DesktopLayout): Promise<DesktopLayout> {
    return request("/api/layout", {
      method: "PUT",
      body: JSON.stringify(layout),
    });
  },
};
