import { spawn } from "node:child_process";
import os from "node:os";
import { REPO_ROOT } from "./updater/git.js";

/**
 * Operaciones de sistema del core: recompilar y reiniciar.
 *
 * El core corre bajo un supervisor (scripts/wtm-server.sh en local, o
 * docker-entrypoint.sh en contenedor) que lo relanza cuando el proceso termina
 * con exit(0). Por eso "reiniciar" = salir limpio: el supervisor levanta la
 * nueva instancia. "Recompilar" = ejecutar el build del monorepo.
 *
 * Emiten su salida linea a linea por un callback (que el terminal reenvia por
 * WebSocket), para que el usuario vea el progreso en vivo.
 */

export type LineSink = (
  kind: "stdout" | "stderr" | "info",
  text: string,
) => void;

let busy = false;

/** Indica si hay una operacion de sistema en curso. */
export function sysBusy(): boolean {
  return busy;
}

function run(
  cmd: string,
  args: string[],
  onLine: LineSink,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    const pipe =
      (kind: "stdout" | "stderr") => (buf: Buffer) => {
        for (const l of buf.toString().split(/\r?\n/)) {
          if (l.length) onLine(kind, l);
        }
      };
    child.stdout.on("data", pipe("stdout"));
    child.stderr.on("data", pipe("stdout")); // npm escribe progreso a stderr
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (e) => {
      onLine("stderr", e.message);
      resolve(1);
    });
  });
}

/** Recompila el monorepo (core + escritorio + shared). */
export async function rebuild(onLine: LineSink): Promise<boolean> {
  if (busy) {
    onLine("stderr", "Ya hay una operacion de sistema en curso.");
    return false;
  }
  busy = true;
  try {
    onLine("info", "Recompilando WTM (npm run build)...");
    const code = await run("npm", ["run", "build"], onLine);
    if (code === 0) {
      onLine("info", "Compilacion correcta.");
      return true;
    }
    onLine("stderr", `La compilacion fallo (codigo ${code}).`);
    return false;
  } finally {
    busy = false;
  }
}

/**
 * Reinicia el core. Opcionalmente recompila primero. El proceso sale con
 * exit(0) tras un breve retardo; el supervisor lo vuelve a levantar.
 */
export async function restart(
  onLine: LineSink,
  withRebuild: boolean,
  onBeforeExit?: () => void,
): Promise<void> {
  if (busy) {
    onLine("stderr", "Ya hay una operacion de sistema en curso.");
    return;
  }
  if (withRebuild) {
    const ok = await rebuild(onLine);
    if (!ok) {
      onLine("stderr", "No se reinicia: la compilacion fallo.");
      return;
    }
  }
  onLine("info", "Reiniciando el core en 1s (el supervisor lo relanza)...");
  onBeforeExit?.();
  setTimeout(() => {
    // Salida limpia: el supervisor (wtm-server.sh / docker) relanza el core.
    process.exit(0);
  }, 1000);
}

/** Metricas rapidas del host para 'wtm status'. */
export function hostStats() {
  const mem = process.memoryUsage();
  return {
    platform: `${os.type()} ${os.release()}`,
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    rssMb: (mem.rss / 1048576).toFixed(1),
    loadAvg: os
      .loadavg()
      .map((n) => n.toFixed(2))
      .join(" "),
    cpus: os.cpus().length,
    freeMemMb: (os.freemem() / 1048576).toFixed(0),
    totalMemMb: (os.totalmem() / 1048576).toFixed(0),
  };
}
