import { useCallback, useEffect, useState } from "react";
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
