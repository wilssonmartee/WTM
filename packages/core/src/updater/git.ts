import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommitInfo } from "@wtm/shared";

const execFileAsync = promisify(execFile);

/**
 * Raiz del repositorio = raiz del proyecto WTM.
 * dist del core esta en packages/core/dist, subimos 3 niveles.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** Ejecuta un comando git en la raiz del repo. Lanza si falla. */
async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
    // No heredar un editor interactivo ni prompts.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

export async function isGitRepo(): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-inside-work-tree"]);
    return out === "true";
  } catch {
    return false;
  }
}

/** Lee el commit actual (HEAD). */
export async function currentCommit(): Promise<CommitInfo | null> {
  try {
    const line = await git([
      "log",
      "-1",
      "--pretty=%H%x1f%h%x1f%s%x1f%an%x1f%cI",
    ]);
    return parseCommitLine(line, line.split("\x1f")[0]);
  } catch {
    return null;
  }
}

function parseCommitLine(line: string, headHash: string): CommitInfo {
  const [hash, shortHash, message, author, date] = line.split("\x1f");
  return {
    hash,
    shortHash,
    message,
    author,
    date,
    current: hash === headHash,
  };
}

/** Historial de commits de la rama actual (para la vista de reversion). */
export async function history(limit = 50): Promise<CommitInfo[]> {
  try {
    const head = await git(["rev-parse", "HEAD"]);
    const out = await git([
      "log",
      `-${limit}`,
      "--pretty=%H%x1f%h%x1f%s%x1f%an%x1f%cI",
    ]);
    if (!out) return [];
    return out.split("\n").map((l) => parseCommitLine(l, head));
  } catch {
    return [];
  }
}

/** Configura el remoto 'origin' con el repo/token dados. */
export async function setRemote(
  repo: string,
  token: string | null,
): Promise<void> {
  // Construimos la URL. Con token para repos privados.
  const url = token
    ? `https://${token}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
  // Si ya existe origin lo actualizamos, si no lo agregamos.
  try {
    await git(["remote", "set-url", "origin", url]);
  } catch {
    await git(["remote", "add", "origin", url]);
  }
}

/** Trae el remoto sin aplicar nada. */
export async function fetch(branch: string): Promise<void> {
  await git(["fetch", "origin", branch, "--prune"]);
}

/** Cuantos commits hay en remoto por delante del local. */
export async function behindCount(branch: string): Promise<number> {
  try {
    const out = await git([
      "rev-list",
      "--count",
      `HEAD..origin/${branch}`,
    ]);
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

/** Mueve el repo a un commit o rama (checkout duro). */
export async function checkout(ref: string): Promise<void> {
  // Guardamos cualquier cambio local para no bloquear el checkout.
  await git(["reset", "--hard"]);
  await git(["checkout", ref]);
}

/** Aplica los commits nuevos de la rama remota (fast-forward duro). */
export async function applyRemote(branch: string): Promise<void> {
  await git(["reset", "--hard", `origin/${branch}`]);
}

/** Hash de HEAD como string corto y largo. */
export async function headHash(): Promise<string> {
  return git(["rev-parse", "HEAD"]);
}

/** Comprueba que un ref/commit existe. */
export async function commitExists(ref: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
