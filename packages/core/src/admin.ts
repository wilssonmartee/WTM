import { db } from "./db.js";
import { hashPassword, newId } from "./crypto.js";
import type {
  Company,
  EffectivePermissions,
  Permission,
  User,
} from "@wtm/shared";
import { ALL_COMPANIES } from "@wtm/shared";

/**
 * Logica de administracion: empresas, usuarios, membresias y permisos de app.
 * Todo esto lo usa el modulo Ajustes (solo admin/superadmin).
 */

// ---------- Empresas ----------
interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}
function toCompany(r: CompanyRow): Company {
  return { id: r.id, name: r.name, slug: r.slug, createdAt: r.created_at };
}

export function listCompanies(): Company[] {
  return (
    db.prepare("SELECT * FROM companies ORDER BY name").all() as CompanyRow[]
  ).map(toCompany);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "empresa";
}

export function createCompany(name: string): Company {
  const id = newId();
  let slug = slugify(name);
  // Evitar colision de slug.
  let n = 1;
  while (db.prepare("SELECT 1 FROM companies WHERE slug = ?").get(slug)) {
    slug = `${slugify(name)}-${++n}`;
  }
  db.prepare(
    "INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, name.trim(), slug, new Date().toISOString());
  return toCompany(
    db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow,
  );
}

export function updateCompany(id: string, name: string): Company | null {
  const exists = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(id);
  if (!exists) return null;
  db.prepare("UPDATE companies SET name = ? WHERE id = ?").run(
    name.trim(),
    id,
  );
  return toCompany(
    db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow,
  );
}

export function deleteCompany(id: string): void {
  // Las membresias caen por ON DELETE CASCADE; limpiamos permisos de esa empresa.
  db.prepare("DELETE FROM permissions WHERE company_id = ?").run(id);
  db.prepare("DELETE FROM memberships WHERE company_id = ?").run(id);
  db.prepare("DELETE FROM companies WHERE id = ?").run(id);
}

// ---------- Usuarios ----------
interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  global_role: string;
  created_at: string;
}
function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    globalRole: r.global_role as User["globalRole"],
    createdAt: r.created_at,
  };
}

export function listUsers(): User[] {
  return (
    db
      .prepare("SELECT * FROM users ORDER BY username")
      .all() as UserRow[]
  ).map(toUser);
}

export function createUser(input: {
  username: string;
  displayName: string;
  email?: string | null;
  password: string;
  globalRole?: User["globalRole"];
}): { ok: boolean; error?: string; user?: User } {
  const username = input.username.trim().toLowerCase();
  if (!username || !input.password) {
    return { ok: false, error: "Usuario y contrasena son obligatorios" };
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return { ok: false, error: "Ese usuario ya existe" };
  }
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, global_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    username,
    input.displayName.trim() || username,
    input.email?.trim() || null,
    hashPassword(input.password),
    input.globalRole ?? "user",
    new Date().toISOString(),
  );
  return {
    ok: true,
    user: toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow),
  };
}

export function updateUser(
  id: string,
  input: {
    displayName?: string;
    email?: string | null;
    password?: string;
    globalRole?: User["globalRole"];
  },
): { ok: boolean; error?: string; user?: User } {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  if (!row) return { ok: false, error: "Usuario no encontrado" };

  if (input.displayName !== undefined)
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
      input.displayName.trim(),
      id,
    );
  if (input.email !== undefined)
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
      input.email?.trim() || null,
      id,
    );
  if (input.globalRole !== undefined)
    db.prepare("UPDATE users SET global_role = ? WHERE id = ?").run(
      input.globalRole,
      id,
    );
  if (input.password)
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(input.password),
      id,
    );

  return {
    ok: true,
    user: toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow),
  };
}

export function deleteUser(
  id: string,
  requesterId: string,
): { ok: boolean; error?: string } {
  if (id === requesterId)
    return { ok: false, error: "No puedes eliminar tu propio usuario" };
  const row = db.prepare("SELECT global_role FROM users WHERE id = ?").get(id) as
    | { global_role: string }
    | undefined;
  if (!row) return { ok: false, error: "Usuario no encontrado" };
  // No permitir borrar el ultimo superadmin.
  if (row.global_role === "superadmin") {
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE global_role = 'superadmin'")
      .get() as { n: number };
    if (count.n <= 1)
      return { ok: false, error: "No puedes eliminar el ultimo superadmin" };
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true };
}

// ---------- Membresias (a que empresas pertenece un usuario) ----------
export function getMemberships(userId: string): string[] {
  return (
    db
      .prepare("SELECT company_id FROM memberships WHERE user_id = ?")
      .all(userId) as { company_id: string }[]
  ).map((r) => r.company_id);
}

export function setMemberships(userId: string, companyIds: string[]): void {
  db.prepare("DELETE FROM memberships WHERE user_id = ?").run(userId);
  const ins = db.prepare(
    "INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, 'member')",
  );
  const tx = db.transaction((ids: string[]) => {
    for (const cid of ids) {
      if (db.prepare("SELECT 1 FROM companies WHERE id = ?").get(cid))
        ins.run(userId, cid);
    }
  });
  tx(companyIds);
}

// ---------- Permisos de app ----------
export function getPermissions(userId: string): Permission[] {
  return (
    db
      .prepare(
        "SELECT user_id, module_id, company_id, level FROM permissions WHERE user_id = ?",
      )
      .all(userId) as {
      user_id: string;
      module_id: string;
      company_id: string;
      level: number;
    }[]
  ).map((r) => ({
    userId: r.user_id,
    moduleId: r.module_id,
    companyId: r.company_id,
    level: r.level as Permission["level"],
  }));
}

/** Reemplaza TODOS los permisos de un usuario por el conjunto dado. */
export function setPermissions(userId: string, perms: Permission[]): void {
  db.prepare("DELETE FROM permissions WHERE user_id = ?").run(userId);
  const ins = db.prepare(
    "INSERT OR REPLACE INTO permissions (user_id, module_id, company_id, level) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction((list: Permission[]) => {
    for (const p of list) {
      const level = Math.max(1, Math.min(10, p.level));
      ins.run(userId, p.moduleId, p.companyId, level);
    }
  });
  tx(perms);
}

/**
 * Permisos efectivos de un usuario (para el cliente). El superadmin/admin
 * tienen nivel 10 en TODO y TODAS las empresas (comodin).
 */
export function effectivePermissions(user: User): EffectivePermissions {
  if (user.globalRole === "superadmin" || user.globalRole === "admin") {
    // Acceso total: nivel 10 a todas las apps conocidas, en todas las empresas.
    const result: EffectivePermissions = {};
    // No conocemos aqui el catalogo; devolvemos un comodin global que el
    // resolver interpreta. Usamos "*" como modulo-comodin tambien.
    result["*"] = { [ALL_COMPANIES]: 10 };
    return result;
  }
  const rows = getPermissions(user.id);
  const map: EffectivePermissions = {};
  for (const p of rows) {
    (map[p.moduleId] ??= {})[p.companyId] = p.level;
  }
  return map;
}

/**
 * Nivel efectivo de un usuario para un modulo en una empresa (en el backend).
 * Devuelve 0 si no tiene acceso.
 */
export function levelFor(
  user: User,
  moduleId: string,
  companyId: string | null,
): number {
  if (user.globalRole === "superadmin" || user.globalRole === "admin")
    return 10;
  const perms = getPermissions(user.id).filter((p) => p.moduleId === moduleId);
  if (perms.length === 0) return 0;
  if (companyId) {
    const exact = perms.find((p) => p.companyId === companyId);
    if (exact) return exact.level;
  }
  const wild = perms.find((p) => p.companyId === ALL_COMPANIES);
  return wild ? wild.level : 0;
}
