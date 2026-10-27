import type {
  AdminUser,
  ApiResponse,
  Appearance,
  AuthSession,
  Company,
  CommitInfo,
  DesktopLayout,
  DynModuleDef,
  DynRecord,
  EffectivePermissions,
  ModuleInfo,
  Permission,
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
  async me(): Promise<{
    user: User;
    companies: Company[];
    permissions: EffectivePermissions;
  }> {
    return request("/api/auth/me");
  },

  // --- Administracion: empresas ---
  async listCompanies(): Promise<Company[]> {
    return request("/api/companies");
  },
  async createCompany(name: string): Promise<Company> {
    return request("/api/companies", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  async updateCompany(id: string, name: string): Promise<Company> {
    return request(`/api/companies/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  },
  async deleteCompany(id: string): Promise<Company[]> {
    return request(`/api/companies/${id}`, { method: "DELETE" });
  },

  // --- Administracion: usuarios ---
  async listUsers(): Promise<AdminUser[]> {
    return request("/api/users");
  },
  async createUser(input: {
    username: string;
    displayName: string;
    email?: string | null;
    password: string;
    globalRole?: User["globalRole"];
  }): Promise<User> {
    return request("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async updateUser(
    id: string,
    input: {
      displayName?: string;
      email?: string | null;
      password?: string;
      globalRole?: User["globalRole"];
    },
  ): Promise<User> {
    return request(`/api/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  async deleteUser(id: string): Promise<{ id: string }> {
    return request(`/api/users/${id}`, { method: "DELETE" });
  },
  async setMemberships(id: string, companyIds: string[]): Promise<string[]> {
    return request(`/api/users/${id}/memberships`, {
      method: "PUT",
      body: JSON.stringify({ companyIds }),
    });
  },
  async setPermissions(
    id: string,
    permissions: Permission[],
  ): Promise<Permission[]> {
    return request(`/api/users/${id}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissions }),
    });
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
  /**
   * Descarga bytes con posibilidad de error legible (JSON). A diferencia de
   * moduleDownload, aqui un fallo (p.ej. SMB caido) lanza con el mensaje del
   * servidor en vez de solo el codigo.
   */
  async moduleDownloadOrThrow(
    moduleId: string,
    path: string,
  ): Promise<Uint8Array> {
    const token = getToken();
    const res = await fetch(`${getServerUrl()}/api/m/${moduleId}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(activeCompanyId ? { "X-WTM-Company": activeCompanyId } : {}),
      },
    });
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* sin cuerpo JSON */
      }
      throw new Error(msg);
    }
    return new Uint8Array(await res.arrayBuffer());
  },

  /**
   * Descarga bytes de un modulo con PROGRESO de descarga (XHR). Util cuando el
   * core puede tardar (p.ej. leer un DBF por SMB) y queremos una barra. Lanza
   * con el mensaje del servidor si responde con error.
   */
  moduleDownloadProgress(
    moduleId: string,
    path: string,
    onProgress?: (fraction: number) => void,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${getServerUrl()}/api/m/${moduleId}${path}`);
      xhr.responseType = "arraybuffer";
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (activeCompanyId) xhr.setRequestHeader("X-WTM-Company", activeCompanyId);
      xhr.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(new Uint8Array(xhr.response as ArrayBuffer));
        } else {
          // El cuerpo de error es JSON; lo decodificamos del ArrayBuffer.
          let msg = `Error ${xhr.status}`;
          try {
            const text = new TextDecoder().decode(
              new Uint8Array(xhr.response as ArrayBuffer),
            );
            const j = JSON.parse(text);
            if (j && j.error) msg = j.error;
          } catch {
            /* sin cuerpo util */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Fallo de red al descargar"));
      xhr.send();
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

  /**
   * Sube bytes binarios a la API de un modulo, con progreso de subida.
   * Usa XHR porque fetch no expone progreso de upload.
   */
  moduleUpload(
    moduleId: string,
    path: string,
    bytes: Uint8Array,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${getServerUrl()}/api/m/${moduleId}${path}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (activeCompanyId)
        xhr.setRequestHeader("X-WTM-Company", activeCompanyId);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || "Error"));
          } catch {
            reject(new Error(`Error ${xhr.status}`));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Fallo de red al subir"));
      // Enviamos el ArrayBuffer subyacente (XHR lo acepta como binario).
      xhr.send(bytes.buffer as ArrayBuffer);
    });
  },

  /** Descarga bytes binarios de la API de un modulo (o null si 404). */
  async moduleDownload(
    moduleId: string,
    path: string,
  ): Promise<Uint8Array | null> {
    const token = getToken();
    const res = await fetch(`${getServerUrl()}/api/m/${moduleId}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(activeCompanyId ? { "X-WTM-Company": activeCompanyId } : {}),
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },

  // --- Estudio de modulos (crear/editar modulos dinamicos) ---
  async estudioList(): Promise<DynModuleDef[]> {
    return request("/api/m/estudio/modules");
  },
  async estudioGet(id: string): Promise<DynModuleDef> {
    return request(`/api/m/estudio/modules/${id}`);
  },
  async estudioCreate(def: DynModuleDef): Promise<DynModuleDef> {
    return request("/api/m/estudio/modules", {
      method: "POST",
      body: JSON.stringify(def),
    });
  },
  async estudioUpdate(id: string, def: DynModuleDef): Promise<DynModuleDef> {
    return request(`/api/m/estudio/modules/${id}`, {
      method: "PUT",
      body: JSON.stringify(def),
    });
  },
  async estudioDelete(id: string, purge = false): Promise<{ id: string }> {
    return request(`/api/m/estudio/modules/${id}?purge=${purge}`, {
      method: "DELETE",
    });
  },

  // --- Catalogo unificado de modulos editables (dinamicos + compilados) ---
  async estudioAll(): Promise<
    {
      id: string;
      name: string;
      icon: string;
      color: string;
      description: string;
      kind: "dynamic" | "builtin" | "other";
      editableFiles: boolean;
    }[]
  > {
    return request("/api/m/estudio/all");
  },

  // --- Archivos de un modulo (editor de codigo estilo WordPress) ---
  // builtin=true selecciona los archivos fuente de un modulo compilado.
  async estudioFiles(
    id: string,
    builtin = false,
  ): Promise<{ path: string; size: number; isDir: boolean }[]> {
    return request(`/api/m/estudio/files/${id}${builtin ? "?builtin=true" : ""}`);
  },
  async estudioReadFile(
    id: string,
    filePath: string,
    builtin = false,
  ): Promise<{ path: string; content: string }> {
    const b = builtin ? "&builtin=true" : "";
    return request(
      `/api/m/estudio/files/${id}/content?path=${encodeURIComponent(filePath)}${b}`,
    );
  },
  async estudioWriteFile(
    id: string,
    filePath: string,
    content: string,
    builtin = false,
  ): Promise<{ path: string; needsRebuild?: boolean }> {
    return request(`/api/m/estudio/files/${id}/content${builtin ? "?builtin=true" : ""}`, {
      method: "PUT",
      body: JSON.stringify({ path: filePath, content }),
    });
  },
  async estudioDeleteFile(
    id: string,
    filePath: string,
  ): Promise<{ path: string }> {
    return request(
      `/api/m/estudio/files/${id}/content?path=${encodeURIComponent(filePath)}`,
      { method: "DELETE" },
    );
  },
  async estudioRebuild(): Promise<{ started: boolean }> {
    return request("/api/m/estudio/rebuild", { method: "POST" });
  },

  // --- Datos de un modulo dinamico (CRUD generico) ---
  async dynDef(moduleId: string): Promise<DynModuleDef> {
    return request(`/api/m/${moduleId}/def`);
  },
  async dynList(moduleId: string): Promise<DynRecord[]> {
    return request(`/api/m/${moduleId}/records`);
  },
  async dynCreate(
    moduleId: string,
    record: Record<string, unknown>,
  ): Promise<DynRecord> {
    return request(`/api/m/${moduleId}/records`, {
      method: "POST",
      body: JSON.stringify(record),
    });
  },
  async dynUpdate(
    moduleId: string,
    recordId: string,
    record: Record<string, unknown>,
  ): Promise<DynRecord> {
    return request(`/api/m/${moduleId}/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify(record),
    });
  },
  async dynDelete(moduleId: string, recordId: string): Promise<{ id: string }> {
    return request(`/api/m/${moduleId}/records/${recordId}`, {
      method: "DELETE",
    });
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
