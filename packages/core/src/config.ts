import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_CORE_PORT } from "@wtm/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Directorio de datos de WTM.
 * - En desarrollo: <repo>/data
 * - Se puede sobreescribir con WTM_DATA_DIR (util para el .exe de Windows).
 */
function resolveDataDir(): string {
  if (process.env.WTM_DATA_DIR) return process.env.WTM_DATA_DIR;
  // dist esta en packages/core/dist -> subimos a la raiz del repo
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "data");
}

export interface CoreConfig {
  port: number;
  dataDir: string;
  dbFile: string;
  jwtSecret: string;
  /** Usuario superadmin inicial que se crea si la DB esta vacia. */
  seedAdminUser: string;
  seedAdminPassword: string;
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

export const config: CoreConfig = {
  port: Number(process.env.WTM_PORT ?? DEFAULT_CORE_PORT),
  dataDir,
  dbFile: path.join(dataDir, "wtm.sqlite"),
  jwtSecret: process.env.WTM_JWT_SECRET ?? "wtm-dev-secret-change-me",
  seedAdminUser: process.env.WTM_ADMIN_USER ?? "admin",
  seedAdminPassword: process.env.WTM_ADMIN_PASSWORD ?? "admin",
};

export { os };
