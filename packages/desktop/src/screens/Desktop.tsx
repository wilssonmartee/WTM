import { useEffect, useMemo, useState } from "react";
import type { ModuleInfo } from "@wtm/shared";
import { MODULE_CATEGORY_LABELS, type ModuleCategory } from "@wtm/shared";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { useWindows } from "../state/windows";
import { Window } from "../components/Window";
import { Icon } from "../components/Icon";
import { Terminal } from "../apps/Terminal";
import { ModuleView } from "../apps/ModuleView";
import { Inventario } from "../apps/Inventario";
import { Actualizaciones } from "../apps/Actualizaciones";
import { wsUrl } from "../lib/config";
import { getToken } from "../lib/api";

export function Desktop() {
  const {
    user,
    companies,
    activeCompanyId,
    setActiveCompany,
    logout,
    appearance,
  } = useAuth();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [clock, setClock] = useState(new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wm = useWindows();
  const taskbarH = appearance.taskbarHeight;
  const isSuperadmin = user?.globalRole === "superadmin";

  useEffect(() => {
    api.modules().then(setModules).catch(() => {});
  }, []);

  async function installModule(id: string) {
    setBusy(id);
    try {
      setModules(await api.installModule(id));
      setToast(`Modulo "${id}" instalado`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Error al instalar");
    } finally {
      setBusy(null);
    }
  }

  async function uninstallModule(id: string) {
    setBusy(id);
    try {
      setModules(await api.uninstallModule(id));
      setToast(`Modulo "${id}" desinstalado`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Error al desinstalar");
    } finally {
      setBusy(null);
    }
  }

  /** Un modulo es "abrible" si esta instalado o es un placeholder visual. */
  function canOpen(m: ModuleInfo): boolean {
    return m.installed || m.status === "coming-soon";
  }

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-ocultar el aviso tras unos segundos.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Escuchar eventos del sistema: cuando el core aplica una actualizacion,
  // avisa y el escritorio se recarga solo para tomar la version nueva.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let reconnect: ReturnType<typeof setTimeout>;
    let ws: WebSocket | null = null;
    const connect = () => {
      ws = new WebSocket(wsUrl("/ws/system", token));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "system-reload") {
            setToast(`${msg.reason}. Recargando...`);
            // El core se reinicia; esperamos y recargamos.
            setTimeout(() => window.location.reload(), 2500);
          }
        } catch {
          /* ignorar */
        }
      };
      ws.onclose = () => {
        reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

  const grouped = useMemo(() => {
    const g = new Map<ModuleCategory, ModuleInfo[]>();
    for (const m of modules) {
      const arr = g.get(m.category) ?? [];
      arr.push(m);
      g.set(m.category, arr);
    }
    return g;
  }, [modules]);

  // Iconos destacados en el escritorio.
  const deskIcons = modules.filter((m) =>
    ["terminal", "facturacion", "inventario", "contabilidad", "ajustes"].includes(
      m.id,
    ),
  );

  function openModule(m: ModuleInfo) {
    if (!canOpen(m)) return;
    wm.open(m);
    setLauncherOpen(false);
  }

  const initials = (user?.displayName ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="wtm-desktop"
      onClick={() => {
        setLauncherOpen(false);
        setUserMenu(false);
      }}
    >
      {/* Iconos del escritorio */}
      <div className="wtm-deskicons" onClick={(e) => e.stopPropagation()}>
        {deskIcons.map((m) => (
          <button
            key={m.id}
            className="wtm-deskicon"
            onDoubleClick={() => openModule(m)}
            title={`Abrir ${m.name}`}
          >
            <span
              className="wtm-deskicon__glyph"
              style={{ background: m.color }}
            >
              <Icon name={m.icon} size={22} />
            </span>
            <span className="wtm-deskicon__label">{m.name}</span>
          </button>
        ))}
      </div>

      {/* Ventanas */}
      <div className="wtm-desktop__surface">
        {wm.windows.map((w) => (
          <Window
            key={w.id}
            win={w}
            taskbarH={taskbarH}
            onFocus={() => wm.focus(w.id)}
            onClose={() => wm.close(w.id)}
            onMinimize={() => wm.minimize(w.id)}
            onToggleMax={() => wm.toggleMax(w.id)}
            onMove={(x, y) => wm.move(w.id, x, y)}
            onResize={(ww, hh) => wm.resize(w.id, ww, hh)}
          >
            {w.module.id === "terminal" ? (
              <Terminal />
            ) : w.module.id === "inventario" ? (
              <Inventario module={w.module} />
            ) : w.module.id === "actualizaciones" ? (
              <Actualizaciones module={w.module} />
            ) : (
              <ModuleView module={w.module} />
            )}
          </Window>
        ))}
      </div>

      {/* Aviso flotante (resultado de instalar/desinstalar) */}
      {toast && <div className="wtm-toast">{toast}</div>}

      {/* Launcher / menu inicio */}
      {launcherOpen && (
        <div className="wtm-launcher" onClick={(e) => e.stopPropagation()}>
          <input
            className="wtm-launcher__search"
            placeholder="Buscar aplicacion..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {[...grouped.entries()].map(([cat, mods]) => {
            const filtered = mods.filter((m) =>
              m.name.toLowerCase().includes(search.toLowerCase()),
            );
            if (filtered.length === 0) return null;
            return (
              <div key={cat}>
                <h3>{MODULE_CATEGORY_LABELS[cat]}</h3>
                <div className="wtm-launcher__list">
                  {filtered.map((m) => {
                    // Un modulo real no instalado se puede instalar; los
                    // "coming-soon" se abren como vista previa.
                    const installable =
                      m.status === "available" && !m.installed;
                    const removable =
                      m.status === "available" &&
                      m.installed &&
                      m.category !== "sistema";
                    return (
                      <div
                        key={m.id}
                        className="wtm-appitem"
                        role="button"
                        onClick={() => openModule(m)}
                        style={{
                          cursor: canOpen(m) ? "pointer" : "default",
                        }}
                      >
                        <span
                          className="wtm-appitem__glyph"
                          style={{ background: m.color }}
                        >
                          <Icon name={m.icon} size={16} />
                        </span>
                        <span className="wtm-appitem__text">
                          <div className="wtm-appitem__name">{m.name}</div>
                          <div className="wtm-appitem__desc">
                            {m.description}
                          </div>
                        </span>
                        {installable && isSuperadmin && (
                          <button
                            className="wtm-tool wtm-tool--primary"
                            style={{ padding: "3px 10px" }}
                            disabled={busy === m.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              installModule(m.id);
                            }}
                          >
                            {busy === m.id ? "..." : "Instalar"}
                          </button>
                        )}
                        {installable && !isSuperadmin && (
                          <span className="wtm-appitem__badge">
                            no instalado
                          </span>
                        )}
                        {removable && isSuperadmin && (
                          <button
                            className="wtm-tool"
                            style={{ padding: "3px 10px" }}
                            disabled={busy === m.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              uninstallModule(m.id);
                            }}
                          >
                            Quitar
                          </button>
                        )}
                        {m.status === "coming-soon" && (
                          <span className="wtm-appitem__badge">pronto</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Menu de usuario */}
      {userMenu && (
        <div className="wtm-menu" onClick={(e) => e.stopPropagation()}>
          <div className="wtm-menu__head">
            <strong>{user?.displayName}</strong>
            <br />
            {user?.globalRole}
          </div>
          <div className="wtm-menu__sep" />
          <button className="wtm-menu__item" onClick={() => setUserMenu(false)}>
            Perfil
          </button>
          <button className="wtm-menu__item" onClick={() => setUserMenu(false)}>
            Preferencias
          </button>
          <div className="wtm-menu__sep" />
          <button className="wtm-menu__item" onClick={logout}>
            Cerrar sesion
          </button>
        </div>
      )}

      {/* Barra de tareas */}
      <div className="wtm-taskbar" onClick={(e) => e.stopPropagation()}>
        <button
          className="wtm-start"
          onClick={() => setLauncherOpen((o) => !o)}
        >
          <span className="wtm-start__dot">{appearance.logoText}</span>
          Inicio
        </button>
        <div className="wtm-taskbar__sep" />

        {companies.length > 0 && (
          <div className="wtm-company">
            <Icon name="home" size={14} />
            <select
              value={activeCompanyId ?? ""}
              onChange={(e) => setActiveCompany(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="wtm-taskbar__apps">
          {wm.windows.map((w) => (
            <button
              key={w.id}
              className={`wtm-taskbtn ${
                !w.minimized ? "wtm-taskbtn--active" : ""
              }`}
              onClick={() =>
                w.minimized ? wm.focus(w.id) : wm.minimize(w.id)
              }
            >
              <Icon name={w.module.icon} size={14} />
              {w.module.name}
            </button>
          ))}
        </div>

        <div className="wtm-tray">
          <div className="wtm-tray__clock">
            <div>{clock.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</div>
            <div style={{ fontSize: 10 }}>
              {clock.toLocaleDateString("es", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </div>
          </div>
          <div
            className="wtm-tray__user"
            onClick={() => setUserMenu((o) => !o)}
          >
            <span className="wtm-avatar">{initials}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
