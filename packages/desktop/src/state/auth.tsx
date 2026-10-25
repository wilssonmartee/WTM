import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Appearance, Company, User } from "@wtm/shared";
import { DEFAULT_APPEARANCE } from "@wtm/shared";
import {
  api,
  getToken,
  setToken,
  setActiveCompanyHeader,
} from "../lib/api";
import { applyAppearance, loadAppearance } from "../lib/appearance";

interface AuthState {
  user: User | null;
  companies: Company[];
  activeCompanyId: string | null;
  appearance: Appearance;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  setActiveCompany: (id: string) => void;
  refreshAppearance: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [loading, setLoading] = useState(true);

  // Mantener la cabecera de empresa activa en sync con el estado.
  useEffect(() => {
    setActiveCompanyHeader(activeCompanyId);
  }, [activeCompanyId]);

  useEffect(() => {
    // El cascaron nativo (thin client) navega aqui con ?token=... tras el
    // login. Lo tomamos, lo guardamos y limpiamos la URL para no dejarlo
    // expuesto en la barra de direcciones ni en el historial.
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setToken(urlToken);
      params.delete("token");
      const clean =
        window.location.pathname +
        (params.toString() ? `?${params}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", clean);
    }

    // La apariencia vive en el core: se descarga y aplica siempre, con o sin
    // sesion (el login tambien se ve con el tema del servidor).
    loadAppearance().then((a) => {
      setAppearance(a);
      applyAppearance(a);
    });

    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((data) => {
        setUser(data.user);
        setCompanies(data.companies);
        setActiveCompanyId(data.companies[0]?.id ?? null);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const session = await api.login(username, password);
    setUser(session.user);
    setCompanies(session.companies);
    setActiveCompanyId(session.companies[0]?.id ?? null);
    // Tras autenticar, recargamos la apariencia (por si el servidor cambio).
    await refreshAppearance();
  }

  async function refreshAppearance() {
    const a = await loadAppearance();
    setAppearance(a);
    applyAppearance(a);
  }

  function logout() {
    setToken(null);
    setUser(null);
    setCompanies([]);
    setActiveCompanyId(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        companies,
        activeCompanyId,
        appearance,
        loading,
        login,
        logout,
        setActiveCompany: setActiveCompanyId,
        refreshAppearance,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
