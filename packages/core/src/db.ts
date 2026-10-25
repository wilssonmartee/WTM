import Database from "better-sqlite3";
import { config } from "./config.js";
import { hashPassword, newId } from "./crypto.js";

/**
 * Capa de datos de WTM.
 *
 * Por defecto usa SQLite embebido (un archivo, cero instalacion) para que en
 * Windows funcione con "copiar carpeta y listo". El esquema esta pensado para
 * migrar a PostgreSQL mas adelante sin tocar la logica de los modulos.
 *
 * Modelo multiempresa:
 * - companies: las empresas (tenants).
 * - users: usuarios del sistema (globales).
 * - memberships: que usuario pertenece a que empresa y con que rol.
 *
 * El aislamiento de datos por empresa lo aplica cada modulo:
 * - dataScope "company": filtra por company_id.
 * - dataScope "shared": ignora company_id y comparte entre empresas.
 */

export const db = new Database(config.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      email         TEXT,
      password_hash TEXT NOT NULL,
      global_role   TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (user_id, company_id)
    );

    -- Registro de modulos instalados en este servidor.
    CREATE TABLE IF NOT EXISTS installed_modules (
      id          TEXT PRIMARY KEY,
      version     TEXT NOT NULL,
      installed_at TEXT NOT NULL
    );

    -- Ajustes del sistema (clave/valor en JSON). Aqui vive la apariencia:
    -- colores, logo, nombre del sistema, fondo, etc. El escritorio los
    -- descarga al cargar, de modo que los cambios esteticos viven en el core.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Layout del escritorio por usuario (ventanas abiertas, tamano, posicion).
    -- Asi el usuario encuentra su escritorio igual desde cualquier dispositivo.
    CREATE TABLE IF NOT EXISTS user_layouts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      layout  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Registro de auditoria de las actualizaciones por git.
    CREATE TABLE IF NOT EXISTS update_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          TEXT NOT NULL,
      action      TEXT NOT NULL,
      from_commit TEXT,
      to_commit   TEXT,
      ok          INTEGER NOT NULL,
      detail      TEXT
    );
  `);
}

/** Crea los datos iniciales si la base esta vacia. */
function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  if (userCount.n > 0) return;

  const now = new Date().toISOString();

  // Empresas de ejemplo para ilustrar el modelo multiempresa.
  const companyA = newId();
  const companyB = newId();
  const insCompany = db.prepare(
    "INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  );
  insCompany.run(companyA, "Empresa Demo A", "demo-a", now);
  insCompany.run(companyB, "Empresa Demo B", "demo-b", now);

  // Superadministrador.
  const adminId = newId();
  db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, global_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    adminId,
    config.seedAdminUser,
    "Super Administrador",
    "admin@wtm.local",
    hashPassword(config.seedAdminPassword),
    "superadmin",
    now,
  );

  // El admin pertenece a ambas empresas.
  const insMember = db.prepare(
    "INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, ?)",
  );
  insMember.run(adminId, companyA, "owner");
  insMember.run(adminId, companyB, "owner");

  // Usuario de ejemplo "juan" con acceso solo a la Empresa A.
  const juanId = newId();
  db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, global_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    juanId,
    "juan",
    "Juan Perez",
    "juan@wtm.local",
    hashPassword("juan"),
    "user",
    now,
  );
  insMember.run(juanId, companyA, "member");

  console.log("[db] Datos iniciales creados.");
  console.log(`[db] Superadmin: ${config.seedAdminUser} / ${config.seedAdminPassword}`);
  console.log("[db] Usuario demo: juan / juan (solo Empresa Demo A)");
}

export function initDb() {
  migrate();
  seed();
}
