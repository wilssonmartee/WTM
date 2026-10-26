import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminUser,
  Appearance,
  Company,
  ModuleInfo,
  ModuleManifest,
  Permission,
} from "@wtm/shared";
import { ACCENT_OPTIONS, ALL_COMPANIES, COLOR_PRESETS } from "@wtm/shared";
import {
  Button,
  Field,
  Input,
  ModuleBody,
  ModuleHeader,
  ModuleShell,
  Notice,
  Select,
  Table,
  Tag,
  Toolbar,
  Spacer,
} from "@wtm/ui";
import { api } from "../lib/api";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Icon";

type Tab = "apariencia" | "empresas" | "usuarios" | "modulos";

export function Ajustes({ module }: { module: ModuleManifest }) {
  const { user } = useAuth();
  const isAdmin =
    user?.globalRole === "superadmin" || user?.globalRole === "admin";
  const [tab, setTab] = useState<Tab>("apariencia");

  return (
    <ModuleShell moduleId="ajustes">
      <ModuleHeader
        icon={<Icon name={module.icon} size={20} />}
        color={module.color}
        title="Ajustes"
        subtitle="Apariencia, empresas, usuarios y modulos"
      />
      <Toolbar>
        <Button
          variant={tab === "apariencia" ? "primary" : "default"}
          onClick={() => setTab("apariencia")}
        >
          Apariencia
        </Button>
        {isAdmin && (
          <>
            <Button
              variant={tab === "empresas" ? "primary" : "default"}
              onClick={() => setTab("empresas")}
            >
              Empresas
            </Button>
            <Button
              variant={tab === "usuarios" ? "primary" : "default"}
              onClick={() => setTab("usuarios")}
            >
              Usuarios
            </Button>
            <Button
              variant={tab === "modulos" ? "primary" : "default"}
              onClick={() => setTab("modulos")}
            >
              Modulos
            </Button>
          </>
        )}
      </Toolbar>
      <ModuleBody>
        {tab === "apariencia" && <AppearancePanel isAdmin={isAdmin} />}
        {tab === "empresas" && isAdmin && <CompaniesPanel />}
        {tab === "usuarios" && isAdmin && <UsersPanel />}
        {tab === "modulos" && isAdmin && <ModulesPanel />}
      </ModuleBody>
    </ModuleShell>
  );
}

// ================= Apariencia =================
// Logo WTM por defecto (SVG embebido como data URL). Un orbe Aero con una "W"
// trazada como linea de crecimiento + barras de datos y "TM" debajo: evoca un
// sistema de gestion empresarial y deja presentes las letras W-T-M.
const WTM_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="orb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5bb3f0"/><stop offset="48%" stop-color="#2f86d6"/><stop offset="52%" stop-color="#1e6fc0"/><stop offset="100%" stop-color="#0f4e95"/></linearGradient><linearGradient id="bars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dcebfb"/></linearGradient><radialGradient id="gloss" cx="50%" cy="30%" r="60%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="60%" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><circle cx="120" cy="120" r="112" fill="url(#orb)" stroke="#0c3f7a" stroke-width="3"/><circle cx="120" cy="120" r="112" fill="url(#gloss)"/><g stroke="url(#bars)" stroke-width="15" stroke-linecap="round" fill="none"><path d="M62 78 L84 165"/><path d="M84 165 L108 108"/><path d="M108 108 L132 165"/><path d="M132 165 L156 78"/></g><g fill="#bfe0ff"><rect x="70" y="150" width="12" height="20" rx="2"/><rect x="114" y="140" width="12" height="30" rx="2"/><rect x="158" y="128" width="12" height="42" rx="2"/></g><rect x="58" y="176" width="124" height="6" rx="3" fill="#bfe0ff" opacity="0.9"/><text x="120" y="205" text-anchor="middle" font-family="Segoe UI, Arial" font-size="20" font-weight="700" letter-spacing="3" fill="#eaf4ff">TM</text></svg>`;
const WTM_DEFAULT_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(WTM_LOGO_SVG)}`;

function AppearancePanel({ isAdmin }: { isAdmin: boolean }) {
  const { appearance, refreshAppearance } = useAuth();
  const [draft, setDraft] = useState<Appearance>(appearance);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(appearance), [appearance]);

  function setMode(mode: "dark" | "light") {
    const preset = COLOR_PRESETS[mode];
    setDraft((d) => ({
      ...d,
      mode,
      colors: { ...preset, accent: d.colors.accent, accent2: d.colors.accent2 },
    }));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await api.setAppearance(draft);
      await refreshAppearance();
      setMsg("Apariencia guardada y aplicada.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {!isAdmin && (
        <Notice>Solo un administrador puede cambiar la apariencia.</Notice>
      )}
      {msg && <Notice tone="success">{msg}</Notice>}

      <h3 style={h3}>Tema</h3>
      <div style={{ display: "flex", gap: 10 }}>
        {(["dark", "light"] as const).map((mode) => (
          <button
            key={mode}
            disabled={!isAdmin}
            onClick={() => setMode(mode)}
            style={{
              ...swatchCard,
              borderColor:
                draft.mode === mode ? "var(--wtm-accent)" : "var(--wtm-border)",
              background: COLOR_PRESETS[mode].surface,
              color: COLOR_PRESETS[mode].text,
            }}
          >
            <div
              style={{
                width: "100%",
                height: 36,
                borderRadius: 6,
                marginBottom: 8,
                background: COLOR_PRESETS[mode].bg,
                border: `1px solid ${COLOR_PRESETS[mode].border}`,
              }}
            />
            {mode === "dark" ? "Oscuro" : "Claro"}
          </button>
        ))}
      </div>

      <h3 style={h3}>Color de acento</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {ACCENT_OPTIONS.map((opt) => (
          <button
            key={opt.accent}
            disabled={!isAdmin}
            title={opt.name}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                colors: { ...d.colors, accent: opt.accent, accent2: opt.accent2 },
              }))
            }
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              cursor: isAdmin ? "pointer" : "default",
              border:
                draft.colors.accent === opt.accent
                  ? "3px solid var(--wtm-text)"
                  : "1px solid var(--wtm-border)",
              background: `linear-gradient(180deg, ${opt.accent}, ${opt.accent2})`,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
            }}
          />
        ))}
      </div>

      <h3 style={h3}>Identidad</h3>
      <div style={{ maxWidth: 360 }}>
        <Field label="Nombre del sistema">
          <Input
            value={draft.systemName}
            disabled={!isAdmin}
            onChange={(e) => setDraft({ ...draft, systemName: e.target.value })}
          />
        </Field>
        <Field label="Eslogan">
          <Input
            value={draft.tagline}
            disabled={!isAdmin}
            onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
          />
        </Field>
      </div>

      <h3 style={h3}>Logo del boton de inicio</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={logoPreviewBox}>
          {draft.logoImage ? (
            <img
              src={draft.logoImage}
              alt="Logo"
              style={{ width: 40, height: 40, objectFit: "contain" }}
            />
          ) : (
            <span style={logoPreviewText}>{draft.logoText || "W"}</span>
          )}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <ImagePicker
            disabled={!isAdmin}
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            maxBytes={512 * 1024}
            label={draft.logoImage ? "Cambiar logo..." : "Subir logo..."}
            onPicked={(dataUrl) =>
              setDraft((d) => ({ ...d, logoImage: dataUrl }))
            }
            onError={setMsg}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="default"
              disabled={!isAdmin}
              onClick={() =>
                setDraft((d) => ({ ...d, logoImage: WTM_DEFAULT_LOGO }))
              }
            >
              Usar logo WTM
            </Button>
            {draft.logoImage && (
              <Button
                variant="ghost"
                disabled={!isAdmin}
                onClick={() => setDraft((d) => ({ ...d, logoImage: "" }))}
              >
                Quitar (usar inicial)
              </Button>
            )}
          </div>
          <span style={{ fontSize: 11, color: "var(--wtm-text-dim)" }}>
            PNG, JPG, SVG o WEBP. Maximo 512 KB. Ideal cuadrado.
          </span>
        </div>
      </div>

      <h3 style={h3}>Fondo de pantalla</h3>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div
          style={{
            ...wallPreviewBox,
            backgroundImage: draft.wallpaper
              ? `url("${draft.wallpaper}")`
              : "radial-gradient(1400px 900px at 50% 120%, #9fc6ee 0%, #6b9bd3 35%, #3f6aa0 100%)",
            backgroundSize:
              draft.wallpaperFit === "tile"
                ? "auto"
                : draft.wallpaperFit === "contain"
                  ? "contain"
                  : draft.wallpaperFit === "center"
                    ? "auto"
                    : "cover",
            backgroundRepeat:
              draft.wallpaperFit === "tile" ? "repeat" : "no-repeat",
            backgroundPosition: "center",
          }}
        />
        <div style={{ display: "grid", gap: 8 }}>
          <ImagePicker
            disabled={!isAdmin}
            accept="image/png,image/jpeg,image/webp"
            maxBytes={4 * 1024 * 1024}
            label={draft.wallpaper ? "Cambiar fondo..." : "Subir fondo..."}
            onPicked={(dataUrl) =>
              setDraft((d) => ({ ...d, wallpaper: dataUrl }))
            }
            onError={setMsg}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--wtm-text-dim)" }}>
              Ajuste:
            </span>
            <select
              className="ui-input"
              disabled={!isAdmin || !draft.wallpaper}
              value={draft.wallpaperFit}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  wallpaperFit: e.target
                    .value as Appearance["wallpaperFit"],
                }))
              }
              style={{ padding: "4px 8px", width: 150 }}
            >
              <option value="cover">Rellenar (cover)</option>
              <option value="contain">Ajustar (contain)</option>
              <option value="center">Centrar</option>
              <option value="tile">Mosaico</option>
            </select>
          </div>
          {draft.wallpaper && (
            <Button
              variant="ghost"
              disabled={!isAdmin}
              onClick={() => setDraft((d) => ({ ...d, wallpaper: "" }))}
            >
              Quitar fondo
            </Button>
          )}
          <span style={{ fontSize: 11, color: "var(--wtm-text-dim)" }}>
            PNG, JPG o WEBP. Maximo 4 MB.
          </span>
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar apariencia"}
          </Button>
        </div>
      )}
    </>
  );
}

/** Selector de imagen: lee un archivo local y lo entrega como data URL. */
function ImagePicker({
  disabled,
  accept,
  maxBytes,
  label,
  onPicked,
  onError,
}: {
  disabled?: boolean;
  accept: string;
  maxBytes: number;
  label: string;
  onPicked: (dataUrl: string) => void;
  onError: (msg: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > maxBytes) {
            onError(
              `La imagen pesa ${(file.size / 1048576).toFixed(1)} MB; el maximo es ${(maxBytes / 1048576).toFixed(1)} MB.`,
            );
            return;
          }
          const reader = new FileReader();
          reader.onload = () => onPicked(String(reader.result));
          reader.onerror = () => onError("No se pudo leer la imagen.");
          reader.readAsDataURL(file);
        }}
      />
      <Button
        variant="default"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

// ================= Empresas =================
function CompaniesPanel() {
  const { refreshSession } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.listCompanies().then(setCompanies).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  async function create() {
    if (!name.trim()) return;
    await api.createCompany(name.trim());
    setName("");
    load();
    refreshSession();
  }
  async function saveEdit(id: string) {
    await api.updateCompany(id, editName);
    setEditing(null);
    load();
    refreshSession();
  }
  async function remove(id: string) {
    await api.deleteCompany(id);
    load();
    refreshSession();
    setMsg("Empresa eliminada.");
  }

  return (
    <>
      {msg && <Notice>{msg}</Notice>}
      <div className="ui-row" style={{ maxWidth: 460 }}>
        <Input
          placeholder="Nombre de la nueva empresa"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <Button variant="primary" onClick={create}>
          Agregar empresa
        </Button>
      </div>

      <Table columns={["Empresa", "Identificador", <span style={{ float: "right" }}>Acciones</span>]}>
        {companies.map((c) => (
          <tr key={c.id}>
            <td>
              {editing === c.id ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ maxWidth: 240 }}
                />
              ) : (
                c.name
              )}
            </td>
            <td style={{ color: "var(--wtm-text-dim)" }}>{c.slug}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {editing === c.id ? (
                <>
                  <Button variant="primary" style={sm} onClick={() => saveEdit(c.id)}>
                    Guardar
                  </Button>{" "}
                  <Button variant="ghost" style={sm} onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    style={sm}
                    onClick={() => {
                      setEditing(c.id);
                      setEditName(c.name);
                    }}
                  >
                    Editar
                  </Button>{" "}
                  <Button variant="ghost" style={sm} onClick={() => remove(c.id)}>
                    Eliminar
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
        {companies.length === 0 && (
          <tr>
            <td colSpan={3} style={{ textAlign: "center" }}>
              Sin empresas.
            </td>
          </tr>
        )}
      </Table>
    </>
  );
}

// ================= Usuarios =================
function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    Promise.all([api.listUsers(), api.listCompanies(), api.modules()])
      .then(([u, c, m]) => {
        setUsers(u);
        setCompanies(c);
        setModules(m);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "Error"));
  }, []);
  useEffect(() => load(), [load]);

  async function removeUser(id: string) {
    try {
      await api.deleteUser(id);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (creating || editing) {
    return (
      <UserEditor
        user={editing}
        companies={companies}
        modules={modules.filter((m) => m.category !== "sistema")}
        onDone={() => {
          setCreating(false);
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <>
      {msg && <Notice tone="error">{msg}</Notice>}
      <Toolbar>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nuevo usuario
        </Button>
        <Spacer />
        <Button variant="ghost" onClick={load}>
          Refrescar
        </Button>
      </Toolbar>
      <Table columns={["Usuario", "Nombre", "Rol", "Empresas", <span style={{ float: "right" }}>Acciones</span>]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.username}</td>
            <td>{u.displayName}</td>
            <td>
              <Tag tone={u.globalRole === "user" ? "default" : "ok"}>
                {u.globalRole}
              </Tag>
            </td>
            <td>{u.companyIds.length}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <Button variant="ghost" style={sm} onClick={() => setEditing(u)}>
                Editar
              </Button>{" "}
              <Button variant="ghost" style={sm} onClick={() => removeUser(u.id)}>
                Eliminar
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function UserEditor({
  user,
  companies,
  modules,
  onDone,
}: {
  user: AdminUser | null;
  companies: Company[];
  modules: ModuleInfo[];
  onDone: () => void;
}) {
  const creating = !user;
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.globalRole ?? "user");
  const [companyIds, setCompanyIds] = useState<string[]>(user?.companyIds ?? []);
  const [perms, setPerms] = useState<Permission[]>(user?.permissions ?? []);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleCompany(id: string) {
    setCompanyIds((cs) =>
      cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id],
    );
  }

  /** Nivel actual de un permiso usuario+modulo+empresa (0 = sin permiso). */
  function levelOf(moduleId: string, companyId: string): number {
    return perms.find((p) => p.moduleId === moduleId && p.companyId === companyId)
      ?.level ?? 0;
  }
  function setLevel(moduleId: string, companyId: string, level: number) {
    setPerms((ps) => {
      const rest = ps.filter(
        (p) => !(p.moduleId === moduleId && p.companyId === companyId),
      );
      if (level <= 0) return rest;
      return [
        ...rest,
        { userId: user?.id ?? "", moduleId, companyId, level: level as Permission["level"] },
      ];
    });
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      let id = user?.id;
      if (creating) {
        const created = await api.createUser({
          username,
          displayName,
          email: email || null,
          password,
          globalRole: role,
        });
        id = created.id;
      } else {
        await api.updateUser(user!.id, {
          displayName,
          email: email || null,
          globalRole: role,
          ...(password ? { password } : {}),
        });
      }
      if (id) {
        await api.setMemberships(id, companyIds);
        await api.setPermissions(
          id,
          perms.map((p) => ({ ...p, userId: id! })),
        );
      }
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // Empresas donde el usuario podra tener permisos = las que se le asignaron.
  const scopeCompanies = companies.filter((c) => companyIds.includes(c.id));

  return (
    <>
      <Toolbar>
        <strong style={{ fontSize: 13 }}>
          {creating ? "Nuevo usuario" : `Editar: ${user!.username}`}
        </strong>
        <Spacer />
        <Button variant="ghost" onClick={onDone}>
          Volver
        </Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </Toolbar>

      {msg && <Notice tone="error">{msg}</Notice>}

      <h3 style={h3}>Datos</h3>
      <div className="ui-form">
        {creating && (
          <Field label="Usuario (para iniciar sesion)">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
        )}
        <Field label="Nombre a mostrar">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email (opcional)">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={creating ? "Contrasena" : "Nueva contrasena (dejar vacio = sin cambio)"}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Rol global">
          <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="user">Usuario</option>
            <option value="admin">Administrador</option>
            <option value="superadmin">Superadministrador</option>
          </Select>
        </Field>
      </div>

      <h3 style={h3}>Empresas a las que pertenece</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {companies.map((c) => (
          <label
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "6px 11px",
              border: "1px solid var(--wtm-border)",
              borderRadius: 6,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={companyIds.includes(c.id)}
              onChange={() => toggleCompany(c.id)}
            />
            {c.name}
          </label>
        ))}
        {companies.length === 0 && (
          <span style={{ color: "var(--wtm-text-dim)" }}>Crea empresas primero.</span>
        )}
      </div>

      <h3 style={h3}>Permisos por app (nivel 0 = sin acceso, 1-10)</h3>
      {role !== "user" ? (
        <Notice>
          Los administradores tienen acceso total a todas las apps y empresas.
        </Notice>
      ) : (
        <PermMatrix
          modules={modules}
          companies={scopeCompanies}
          levelOf={levelOf}
          setLevel={setLevel}
        />
      )}
    </>
  );
}

/** Matriz app × (todas + cada empresa) con un selector de nivel 0-10. */
function PermMatrix({
  modules,
  companies,
  levelOf,
  setLevel,
}: {
  modules: ModuleInfo[];
  companies: Company[];
  levelOf: (m: string, c: string) => number;
  setLevel: (m: string, c: string, lvl: number) => void;
}) {
  const scopes = [
    { id: ALL_COMPANIES, name: "Todas las empresas" },
    ...companies.map((c) => ({ id: c.id, name: c.name })),
  ];
  return (
    <Table columns={["App", ...scopes.map((s) => s.name)]}>
      {modules.map((m) => (
        <tr key={m.id}>
          <td>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: m.color,
                  display: "inline-grid",
                  placeItems: "center",
                  color: "#fff",
                }}
              >
                <Icon name={m.icon} size={12} />
              </span>
              {m.name}
            </span>
          </td>
          {scopes.map((s) => (
            <td key={s.id}>
              <select
                className="ui-input ui-select"
                style={{ width: 64, padding: "3px 6px" }}
                value={levelOf(m.id, s.id)}
                onChange={(e) => setLevel(m.id, s.id, Number(e.target.value))}
              >
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? "—" : i}
                  </option>
                ))}
              </select>
            </td>
          ))}
        </tr>
      ))}
      {modules.length === 0 && (
        <tr>
          <td colSpan={scopes.length + 1} style={{ textAlign: "center" }}>
            Sin apps de negocio.
          </td>
        </tr>
      )}
    </Table>
  );
}

// ================= Modulos =================
function ModulesPanel() {
  const { refreshSession } = useAuth();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.modules().then(setModules).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  async function install(id: string) {
    setBusy(id);
    setMsg("");
    try {
      setModules(await api.installModule(id));
      refreshSession();
      setMsg(`Modulo "${id}" instalado.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }
  async function uninstall(id: string, purge: boolean) {
    setBusy(id);
    setMsg("");
    try {
      setModules(await api.uninstallModule(id, purge));
      refreshSession();
      setMsg(`Modulo "${id}" desinstalado${purge ? " (datos borrados)" : ""}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {msg && <Notice tone="success">{msg}</Notice>}
      <Table columns={["App", "Version", "Estado", <span style={{ float: "right" }}>Acciones</span>]}>
        {modules.map((m) => {
          const system = m.category === "sistema";
          const installable = m.status === "available" && !m.installed;
          const removable = m.status === "available" && m.installed && !system;
          return (
            <tr key={m.id}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: m.color,
                      display: "inline-grid",
                      placeItems: "center",
                      color: "#fff",
                    }}
                  >
                    <Icon name={m.icon} size={13} />
                  </span>
                  {m.name}
                </span>
              </td>
              <td>{m.version}</td>
              <td>
                {system ? (
                  <Tag>sistema</Tag>
                ) : m.installed ? (
                  <Tag tone="ok">instalado</Tag>
                ) : m.status === "coming-soon" ? (
                  <Tag tone="warn">proximamente</Tag>
                ) : (
                  <Tag>disponible</Tag>
                )}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {installable && (
                  <Button
                    variant="primary"
                    style={sm}
                    disabled={busy === m.id}
                    onClick={() => install(m.id)}
                  >
                    {busy === m.id ? "..." : "Instalar"}
                  </Button>
                )}
                {removable && (
                  <>
                    <Button
                      variant="ghost"
                      style={sm}
                      disabled={busy === m.id}
                      onClick={() => uninstall(m.id, false)}
                    >
                      Desinstalar
                    </Button>{" "}
                    <Button
                      variant="danger"
                      style={sm}
                      disabled={busy === m.id}
                      onClick={() => uninstall(m.id, true)}
                    >
                      Borrar datos
                    </Button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

const h3: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--wtm-text-dim)",
  margin: "20px 0 10px",
};
const swatchCard: React.CSSProperties = {
  width: 130,
  padding: 12,
  borderRadius: 10,
  border: "2px solid var(--wtm-border)",
  textAlign: "center",
  fontSize: 13,
  cursor: "pointer",
};
const sm: React.CSSProperties = { padding: "3px 10px" };

const logoPreviewBox: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 12,
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(180deg, #2a3a52, #1b2636)",
  border: "1px solid var(--wtm-border)",
  flexShrink: 0,
};
const logoPreviewText: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  color: "#cfe6ff",
};
const wallPreviewBox: React.CSSProperties = {
  width: 180,
  height: 108,
  borderRadius: 8,
  border: "1px solid var(--wtm-border)",
  flexShrink: 0,
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
};
