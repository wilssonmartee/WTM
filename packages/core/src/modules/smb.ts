/**
 * Cliente SMB para modulos que necesitan leer archivos de un recurso
 * compartido (p.ej. el DBF de Articulos vive en un servidor Samba).
 *
 * La libreria @marsaud/smb2 se instala DINAMICAMENTE por el gestor de
 * dependencias de modulos (ref-counting). Por eso NO se declara en el
 * package.json del core y se importa con import() en tiempo de ejecucion:
 * esbuild la deja fuera del bundle (ver external en build.mjs) y solo se
 * carga cuando el modulo que la requiere esta instalado.
 */

export interface SmbConnection {
  host: string; // IP o nombre del servidor Samba
  share: string; // nombre del recurso compartido
  username: string;
  password: string;
  domain?: string;
}

// La ruta dentro del share usa backslashes en SMB. Normalizamos desde lo que
// escriba el usuario (acepta / o \) y quitamos barras iniciales.
export function normalizeSmbPath(p: string): string {
  return p.replace(/[/\\]+/g, "\\").replace(/^\\+/, "");
}

interface SmbReadStream {
  on(ev: "data", cb: (chunk: Buffer) => void): void;
  on(ev: "end", cb: () => void): void;
  on(ev: "error", cb: (err: Error) => void): void;
  /** Tamano total del archivo en bytes (lo expone v9u-smb2 al abrir). */
  fileSize?: number;
  destroy?(): void;
}

interface Smb2Like {
  readFile(path: string, cb: (err: Error | null, data: Buffer) => void): void;
  createReadStream(
    path: string,
    cb: (err: Error | null, stream: SmbReadStream) => void,
  ): void;
  readdir(
    path: string,
    cb: (err: Error | null, files: string[]) => void,
  ): void;
  exists(path: string, cb: (err: Error | null, exists: boolean) => void): void;
  disconnect(): void;
}

type Smb2Ctor = new (opts: {
  share: string;
  domain: string;
  username: string;
  password: string;
  autoCloseTimeout?: number;
}) => Smb2Like;

async function loadSmb2(): Promise<Smb2Ctor> {
  try {
    const mod = (await import("@tryjsky/v9u-smb2")) as unknown as {
      default?: Smb2Ctor;
    } & Smb2Ctor;
    // La libreria exporta la clase como module.exports (default en ESM interop).
    return (mod.default ?? (mod as unknown as Smb2Ctor)) as Smb2Ctor;
  } catch (e) {
    throw new Error(
      "La libreria SMB no esta instalada. Reinstala el modulo que la requiere. Detalle: " +
        (e as Error).message,
    );
  }
}

function makeClient(conn: SmbConnection, Smb2: Smb2Ctor): Smb2Like {
  // @marsaud/smb2 toma el share completo en formato UNC: \\host\share
  const share = `\\\\${conn.host}\\${conn.share}`;
  const client = new Smb2({
    share,
    domain: conn.domain || "",
    username: conn.username,
    password: conn.password,
    autoCloseTimeout: 0,
  });
  // Blindaje CRITICO: el cliente SMB es un EventEmitter cuyo socket puede
  // emitir 'error' (host caido, auth fallida, conexion cerrada). Sin un
  // listener de 'error', Node lanza la excepcion y TUMBA el proceso entero
  // (eso es lo que el navegador ve como "Failed to fetch"). Adjuntamos un
  // listener no-op: el error real ya se propaga por el callback de cada
  // operacion, que lo convierte en una respuesta de error limpia.
  try {
    (client as unknown as { on?: (ev: string, cb: () => void) => void }).on?.(
      "error",
      () => {
        /* ignorado: el error se maneja en el callback de la operacion */
      },
    );
  } catch {
    /* si no es EventEmitter, seguimos */
  }
  return client;
}

/**
 * Envuelve una promesa con un limite de tiempo. Si el servidor SMB no responde
 * (host inalcanzable), evitamos que la peticion quede colgada indefinidamente.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `Tiempo de espera agotado (${label}). Revisa host, red o credenciales.`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const SMB_TIMEOUT_MS = 15000;
// Leer un DBF grande por SMB puede tardar mas que una prueba de conexion.
const SMB_READ_TIMEOUT_MS = 120000;
const TCP_PROBE_MS = 5000;
const SMB_PORT = 445;

/**
 * Comprobacion previa: abrir un socket TCP al puerto 445 del host. Permite dar
 * un diagnostico claro (host inalcanzable / puerto cerrado) antes de intentar
 * el handshake SMB, que de otro modo solo diria "tiempo de espera agotado".
 */
function tcpProbe(host: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    // import diferido: solo se usa aqui.
    import("node:net")
      .then(({ Socket }) => {
        const socket = new Socket();
        let done = false;
        const finish = (ok: boolean, detail: string) => {
          if (done) return;
          done = true;
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
          resolve({ ok, detail });
        };
        socket.setTimeout(TCP_PROBE_MS);
        socket.once("connect", () =>
          finish(true, "Puerto 445 accesible."),
        );
        socket.once("timeout", () =>
          finish(
            false,
            `No hay respuesta del host ${host} en el puerto ${SMB_PORT}. Revisa que el equipo este encendido, en la misma red y con SMB/compartir activado (firewall del puerto 445).`,
          ),
        );
        socket.once("error", (e: NodeJS.ErrnoException) => {
          const code = e.code ?? "";
          let detail = e.message;
          if (code === "ECONNREFUSED")
            detail = `El host ${host} rechaza el puerto ${SMB_PORT}: SMB no esta escuchando ahi.`;
          else if (code === "EHOSTUNREACH" || code === "ENETUNREACH")
            detail = `No se alcanza el host ${host} (sin ruta de red).`;
          else if (code === "ENOTFOUND")
            detail = `No se resuelve el nombre ${host}.`;
          finish(false, detail);
        });
        socket.connect(SMB_PORT, host);
      })
      .catch((e) => resolve({ ok: false, detail: (e as Error).message }));
  });
}

/**
 * Lee un archivo del share SMB y devuelve su contenido como Buffer.
 * onProgress(leidos, total) se llama durante la lectura por bloques para que
 * la UI pueda mostrar una barra de avance (total puede ser 0 si se desconoce).
 */
export async function smbReadFile(
  conn: SmbConnection,
  filePath: string,
  onProgress?: (read: number, total: number) => void,
): Promise<Buffer> {
  // Preflight TCP: diagnostico de red claro antes del handshake SMB.
  const probe = await tcpProbe(conn.host);
  if (!probe.ok) throw new Error(`Red: ${probe.detail}`);

  const Smb2 = await loadSmb2();
  const client = makeClient(conn, Smb2);
  const rel = normalizeSmbPath(filePath);
  try {
    // Leemos por STREAM (bloques), no readFile de golpe: los DBF grandes hacen
    // que el servidor responda STATUS_PENDING si se pide todo en una operacion.
    // El stream lee en trozos y evita ese error, ademas de usar menos memoria.
    return await withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        client.createReadStream(rel, (err, stream) => {
          if (err) {
            reject(new Error(smbErrorHint(err)));
            return;
          }
          const total = stream.fileSize ?? 0;
          let read = 0;
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => {
            const b = Buffer.from(chunk);
            chunks.push(b);
            read += b.length;
            if (onProgress) onProgress(read, total);
          });
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", (e) => reject(new Error(smbErrorHint(e))));
        });
      }),
      SMB_READ_TIMEOUT_MS,
      "leer archivo",
    );
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/** Lista los archivos de una carpeta del share SMB. */
export async function smbReadDir(
  conn: SmbConnection,
  dirPath: string,
): Promise<string[]> {
  const Smb2 = await loadSmb2();
  const client = makeClient(conn, Smb2);
  const rel = normalizeSmbPath(dirPath || "");
  try {
    return await withTimeout(
      new Promise<string[]>((resolve, reject) => {
        client.readdir(rel, (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      }),
      SMB_TIMEOUT_MS,
      "listar carpeta",
    );
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prueba la conexion: intenta leer la carpeta raiz del share. Devuelve un
 * mensaje claro de exito o error para la UI de configuracion.
 */
export async function smbTest(
  conn: SmbConnection,
  probePath?: string,
): Promise<{ ok: boolean; detail: string }> {
  // FASE 1: comprobacion TCP del puerto 445. Separa "no llego al servidor" de
  // "llego pero SMB/credenciales/ruta fallan".
  const probe = await tcpProbe(conn.host);
  if (!probe.ok) {
    return { ok: false, detail: `Red: ${probe.detail}` };
  }

  // FASE 2: handshake SMB + autenticacion, listando la raiz del recurso.
  let Smb2: Smb2Ctor;
  try {
    Smb2 = await loadSmb2();
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  const client = makeClient(conn, Smb2);
  try {
    try {
      await withTimeout(
        new Promise<string[]>((resolve, reject) => {
          client.readdir("", (err, files) =>
            err ? reject(err) : resolve(files),
          );
        }),
        SMB_TIMEOUT_MS,
        "abrir recurso",
      );
    } catch (e) {
      return {
        ok: false,
        detail: `Puerto 445 abierto, pero no se pudo abrir el recurso "${conn.share}": ${smbErrorHint(e as Error)}`,
      };
    }

    // FASE 3 (opcional): comprobar que el archivo exista dentro del recurso.
    if (probePath && probePath.trim()) {
      const rel = normalizeSmbPath(probePath);
      try {
        const exists = await withTimeout(
          new Promise<boolean>((resolve, reject) => {
            client.exists(rel, (err, ex) => (err ? reject(err) : resolve(ex)));
          }),
          SMB_TIMEOUT_MS,
          "comprobar archivo",
        );
        return exists
          ? { ok: true, detail: "Conexion correcta y archivo encontrado." }
          : {
              ok: false,
              detail: `Conecta al recurso, pero no existe el archivo en "${rel}". Revisa la ruta (relativa al recurso, sin repetir su nombre).`,
            };
      } catch (e) {
        return {
          ok: false,
          detail: `Conecta al recurso, pero fallo al comprobar el archivo: ${smbErrorHint(e as Error)}`,
        };
      }
    }
    return { ok: true, detail: "Conexion y recurso correctos." };
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/** Traduce errores comunes de SMB a pistas en espanol. */
function smbErrorHint(e: Error): string {
  const msg = (e.message || "").toUpperCase();
  if (msg.includes("STATUS_LOGON_FAILURE") || msg.includes("LOGON"))
    return "credenciales incorrectas (usuario/contrasena/dominio).";
  if (msg.includes("STATUS_BAD_NETWORK_NAME") || msg.includes("BAD_NETWORK"))
    return `el recurso compartido no existe con ese nombre.`;
  if (msg.includes("STATUS_ACCESS_DENIED") || msg.includes("ACCESS_DENIED"))
    return "acceso denegado: el usuario no tiene permiso sobre el recurso.";
  if (msg.includes("STATUS_OBJECT_NAME_NOT_FOUND") || msg.includes("NOT_FOUND"))
    return "no se encontro la ruta dentro del recurso.";
  if (msg.includes("STATUS_NOT_SUPPORTED") || msg.includes("NOT_SUPPORTED"))
    return "el servidor rechazo el protocolo (puede requerir SMB1/NTLM no soportado).";
  return e.message || "error desconocido";
}
