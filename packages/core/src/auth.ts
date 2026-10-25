import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { verifyPassword } from "./crypto.js";
import type { AuthSession, Company, User } from "@wtm/shared";

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  password_hash: string;
  global_role: string;
  created_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    globalRole: row.global_role as User["globalRole"],
    createdAt: row.created_at,
  };
}

function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
  };
}

/** Empresas a las que el usuario tiene acceso. */
export function companiesForUser(userId: string): Company[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM companies c
       JOIN memberships m ON m.company_id = c.id
       WHERE m.user_id = ?
       ORDER BY c.name`,
    )
    .all(userId) as CompanyRow[];
  return rows.map(toCompany);
}

export function login(username: string, password: string): AuthSession | null {
  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  const user = toUser(row);
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
    expiresIn: "7d",
  });
  return { token, user, companies: companiesForUser(user.id) };
}

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  return row ? toUser(row) : null;
}

/** Extiende Request con el usuario autenticado y la empresa activa. */
export interface AuthedRequest extends Request {
  user?: User;
  /** Empresa activa de la peticion (cabecera X-WTM-Company). */
  companyId?: string;
}

/** Verifica que el usuario pertenezca a la empresa indicada. */
export function userBelongsToCompany(
  userId: string,
  companyId: string,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM memberships WHERE user_id = ? AND company_id = ?",
    )
    .get(userId, companyId);
  return !!row;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ ok: false, error: "Sesion invalida" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Token invalido o expirado" });
  }
}

/**
 * Resuelve la empresa activa desde la cabecera X-WTM-Company y verifica que
 * el usuario tenga acceso. Debe ir despues de requireAuth. Si el modulo es de
 * datos compartidos, la empresa es opcional.
 */
export function withCompany(required: boolean) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const companyId = req.header("X-WTM-Company") ?? undefined;
    if (!companyId) {
      if (required) {
        res
          .status(400)
          .json({ ok: false, error: "Falta la empresa activa" });
        return;
      }
      next();
      return;
    }
    if (!userBelongsToCompany(req.user!.id, companyId)) {
      res
        .status(403)
        .json({ ok: false, error: "Sin acceso a esta empresa" });
      return;
    }
    req.companyId = companyId;
    next();
  };
}

/** Valida un token y devuelve el usuario (para WebSocket). */
export function userFromToken(token: string): User | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    return getUserById(payload.sub);
  } catch {
    return null;
  }
}
