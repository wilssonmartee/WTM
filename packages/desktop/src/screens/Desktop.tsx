import { useEffect, useMemo, useRef, useState } from "react";
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
import { Ajustes } from "../apps/Ajustes";
import { Articulos } from "../apps/articulos/Articulos";
import { wsUrl, getServerUrl } from "../lib/config";
import { getToken } from "../lib/api";
import type { SnapZone } from "../state/windows";
import { snapGeom } from "../state/windows";

/** Estilo del rectangulo de vista previa para una zona de snap. */
function snapPreviewStyle(
  zone: SnapZone,
  taskbarH: number,
): React.CSSProperties {
  if (zone === "top") {
    return { left: 0, top: 0, width: "100vw", height: `calc(100vh - ${taskbarH}px)` };
  }
  const g = snapGeom(zone, taskbarH);
  if (!g || g.width === undefined) return { display: "none" };
  return { left: g.x, top: g.y, width: g.width, height: g.height };
}

export function Desktop() {
  const {
    user,
    companies,
    activeCompanyId,
    setActiveCompany,
    logout,
    appearance,
    levelFor,
  } = useAuth();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [snapHint, setSnapHint] = useState<SnapZone>(null);
  const [clock, setClock] = useState(new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const taskbarH = appearance.taskbarHeight;
  const wm = useWindows(user?.id ?? null, modules, taskbarH);

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

  const isAdmin =
    user?.globalRole === "superadmin" || user?.globalRole === "admin";

  /**
   * Un usuario PUEDE VER una app si:
   *  - es admin (ve todo), o
   *  - los modulos de sistema requieren admin, o
   *  - para un modulo de negocio, tiene permiso (nivel >= minLevel) en la
   *    empresa activa.
   * Las vistas previas (coming-soon) solo las ve el admin.
   */
  function canSee(m: ModuleInfo): boolean {
    if (isAdmin) return true;
    if (m.category === "sistema") return false; // terminal/ajustes/updates: admin
    if (m.status === "coming-soon") return false;
    const min = m.minLevel ?? 1;
    return levelFor(m.id) >= min;
  }

  /** Abrible = visible y (instalado o vista previa). */
  function canOpen(m: ModuleInfo): boolean {
    return canSee(m) && (m.installed || m.status === "coming-soon");
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

  // --- Navegacion y atajos de teclado (sensacion nativa) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape: cierra menus abiertos; si no hay, cierra la ventana enfocada.
      if (e.key === "Escape") {
        if (launcherOpen || userMenu || arrangeOpen) {
          setLauncherOpen(false);
          setUserMenu(false);
          setArrangeOpen(false);
          return;
        }
        const top = [...wm.windows]
          .filter((w) => !w.minimized)
          .sort((a, b) => b.z - a.z)[0];
        if (top) wm.close(top.id);
        return;
      }
      // Tecla Windows / Meta o Ctrl+Escape: abre/cierra el menu inicio.
      if (
        (e.key === "Meta" || (e.ctrlKey && e.key === "Escape")) &&
        !e.repeat
      ) {
        e.preventDefault();
        setLauncherOpen((o) => !o);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launcherOpen, userMenu, arrangeOpen, wm]);

  // Espera a que el core vuelva (tras reiniciarse por una actualizacion) y
  // recarga el escritorio. Sondea /api/health hasta que responda.
  function waitForCoreAndReload() {
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const r = await fetch(`${getServerUrl()}/api/health`, {
          cache: "no-store",
        });
        if (r.ok) {
          window.location.reload();
          return;
        }
      } catch {
        /* core aun reiniciando */
      }
      if (tries < 60) setTimeout(poll, 1000);
      else window.location.reload();
    };
    // Dar margen a que el core cierre antes de empezar a sondear.
    setTimeout(poll, 2000);
  }

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
            // El core se reinicia; esperamos a que vuelva y recargamos.
            waitForCoreAndReload();
          } else if (msg.type === "update-progress") {
            // Reenviar a quien escuche (el modulo Actualizaciones).
            window.dispatchEvent(
              new CustomEvent("wtm:update-progress", { detail: msg }),
            );
          } else if (msg.type === "module-progress") {
            // Progreso de un modulo (p.ej. Articulos leyendo un DBF por SMB).
            window.dispatchEvent(
              new CustomEvent("wtm:module-progress", { detail: msg }),
            );
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
  const deskIcons = modules.filter(
    (m) =>
      [
        "terminal",
        "articulos",
        "facturacion",
        "inventario",
        "contabilidad",
        "ajustes",
      ].includes(m.id) && canSee(m),
  );

  async function openModule(m: ModuleInfo) {
    setLauncherOpen(false);
    // Si no puede verlo, no abrir.
    if (!canSee(m)) {
      setToast(`No tienes permiso para "${m.name}"`);
      return;
    }
    // Modulo real no instalado: instalarlo al vuelo (si eres admin) y abrir.
    if (!m.installed && m.status === "available") {
      if (isAdmin) {
        const updated = await api.installModule(m.id).catch(() => null);
        if (updated) {
          setModules(updated);
          const fresh = updated.find((x) => x.id === m.id) ?? m;
          wm.open(fresh);
          setToast(`Modulo "${m.name}" instalado y abierto`);
        } else {
          setToast(`No se pudo instalar "${m.name}"`);
        }
      } else {
        setToast(`"${m.name}" no esta instalado. Pide a un administrador que lo instale.`);
      }
      return;
    }
    // Coming-soon o ya instalado: abrir directo.
    wm.open(m);
  }

  // Deteccion manual de doble clic (robusta en navegadores reales): el primer
  // clic selecciona; un segundo clic dentro de 350ms abre el modulo.
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  function handleIconClick(m: ModuleInfo) {
    const now = Date.now();
    const prev = lastClick.current;
    if (prev && prev.id === m.id && now - prev.at < 350) {
      lastClick.current = null;
      setSelectedIcon(null);
      openModule(m);
    } else {
      lastClick.current = { id: m.id, at: now };
      setSelectedIcon(m.id);
    }
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
        setArrangeOpen(false);
        setSelectedIcon(null);
      }}
    >
      {/* Iconos del escritorio */}
      <div className="wtm-deskicons" onClick={(e) => e.stopPropagation()}>
        {deskIcons.map((m) => (
          <button
            key={m.id}
            className={`wtm-deskicon ${
              selectedIcon === m.id ? "wtm-deskicon--selected" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handleIconClick(m);
            }}
            onKeyDown={(e) => {
              // Enter / Espacio abre directo (un solo toque con teclado).
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedIcon(null);
                openModule(m);
                return;
              }
              // Flechas: mover el foco entre iconos.
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const btns = Array.from(
                  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    ".wtm-deskicon",
                  ) ?? [],
                );
                const i = btns.indexOf(e.currentTarget);
                const next =
                  e.key === "ArrowDown"
                    ? btns[i + 1]
                    : btns[i - 1];
                next?.focus();
              }
            }}
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
        {/* Vista previa de acople (snap) mientras se arrastra al borde */}
        {snapHint && (
          <div
            className="wtm-snap-preview"
            style={snapPreviewStyle(snapHint, taskbarH)}
          />
        )}
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
            onSnapHint={setSnapHint}
            onSnap={(zone) => wm.snapTo(w.id, zone)}
          >
            {w.module.id === "terminal" ? (
              <Terminal />
            ) : w.module.id === "inventario" ? (
              <Inventario module={w.module} />
            ) : w.module.id === "actualizaciones" ? (
              <Actualizaciones module={w.module} />
            ) : w.module.id === "ajustes" ? (
              <Ajustes module={w.module} />
            ) : w.module.id === "articulos" ? (
              <Articulos module={w.module} />
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Abrir el primer resultado que coincida con la busqueda.
                const first = modules.find((m) =>
                  m.name.toLowerCase().includes(search.toLowerCase()),
                );
                if (first) {
                  setSearch("");
                  openModule(first);
                }
              } else if (e.key === "ArrowDown") {
                // Bajar el foco al primer item de la lista.
                e.preventDefault();
                (
                  e.currentTarget.parentElement?.querySelector(
                    ".wtm-appitem",
                  ) as HTMLElement | null
                )?.focus();
              }
            }}
            autoFocus
          />
          {[...grouped.entries()].map(([cat, mods]) => {
            const filtered = mods.filter(
              (m) =>
                // Solo apps que el usuario puede ver (admin ve todo).
                (canSee(m) || (isAdmin && m.status === "available")) &&
                m.name.toLowerCase().includes(search.toLowerCase()),
            );
            if (filtered.length === 0) return null;
            return (
              <div key={cat}>
                <h3>{MODULE_CATEGORY_LABELS[cat]}</h3>
                <div className="wtm-launcher__list">
                  {filtered.map((m) => {
                    // Un modulo real no instalado se puede instalar desde aqui
                    // (gestion completa en Ajustes > Modulos).
                    const installable =
                      m.status === "available" && !m.installed;
                    return (
                      <div
                        key={m.id}
                        className="wtm-appitem"
                        role="button"
                        tabIndex={0}
                        onClick={() => openModule(m)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openModule(m);
                          } else if (
                            e.key === "ArrowDown" ||
                            e.key === "ArrowUp"
                          ) {
                            e.preventDefault();
                            const items = Array.from(
                              document.querySelectorAll<HTMLElement>(
                                ".wtm-appitem",
                              ),
                            );
                            const i = items.indexOf(e.currentTarget);
                            (e.key === "ArrowDown"
                              ? items[i + 1]
                              : items[i - 1]
                            )?.focus();
                          }
                        }}
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
                        {installable && isAdmin && (
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

      {/* Menu de organizar ventanas (tipo Snap de Windows) */}
      {arrangeOpen && (
        <div
          className="wtm-menu wtm-menu--arrange"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wtm-menu__head">Organizar ventanas</div>
          <div className="wtm-menu__sep" />
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("left");
              setArrangeOpen(false);
            }}
          >
            Acoplar a la izquierda
          </button>
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("right");
              setArrangeOpen(false);
            }}
          >
            Acoplar a la derecha
          </button>
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("grid");
              setArrangeOpen(false);
            }}
          >
            Mosaico (cuadricula)
          </button>
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("cascade");
              setArrangeOpen(false);
            }}
          >
            Cascada
          </button>
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("maximize-all");
              setArrangeOpen(false);
            }}
          >
            Maximizar todo
          </button>
          <div className="wtm-menu__sep" />
          <button
            className="wtm-menu__item"
            onClick={() => {
              wm.arrange("center-all");
              setArrangeOpen(false);
            }}
          >
            Traer todo al centro
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
              onContextMenu={(e) => {
                // Clic derecho: traer la ventana al centro (rescate).
                e.preventDefault();
                wm.center(w.id);
              }}
              title={`${w.module.name} — clic derecho para traer al centro`}
            >
              <Icon name={w.module.icon} size={14} />
              {w.module.name}
            </button>
          ))}
        </div>

        <div className="wtm-tray">
          {wm.windows.some((w) => !w.minimized) && (
            <button
              className="wtm-tray__btn"
              title="Organizar ventanas"
              onClick={(e) => {
                e.stopPropagation();
                setArrangeOpen((o) => !o);
              }}
            >
              <Icon name="grid" size={15} />
            </button>
          )}
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
