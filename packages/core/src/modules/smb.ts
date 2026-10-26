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

interface Smb2Like {
  readFile(path: string, cb: (err: Error | null, data: Buffer) => void): void;
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
    const mod = (await import("@marsaud/smb2")) as unknown as {
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
  return new Smb2({
    share,
    domain: conn.domain || "",
    username: conn.username,
    password: conn.password,
    autoCloseTimeout: 0,
  });
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

/** Lee un archivo del share SMB y devuelve su contenido como Buffer. */
export async function smbReadFile(
  conn: SmbConnection,
  filePath: string,
): Promise<Buffer> {
  const Smb2 = await loadSmb2();
  const client = makeClient(conn, Smb2);
  const rel = normalizeSmbPath(filePath);
  try {
    return await withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        client.readFile(rel, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      }),
      SMB_TIMEOUT_MS,
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
  try {
    const Smb2 = await loadSmb2();
    const client = makeClient(conn, Smb2);
    try {
      if (probePath && probePath.trim()) {
        // Si hay ruta de archivo, comprobamos que exista.
        const rel = normalizeSmbPath(probePath);
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
              detail: "Conecta, pero no se encontro el archivo en esa ruta.",
            };
      }
      // Sin ruta: listamos la raiz del share.
      await withTimeout(
        new Promise<string[]>((resolve, reject) => {
          client.readdir("", (err, files) =>
            err ? reject(err) : resolve(files),
          );
        }),
        SMB_TIMEOUT_MS,
        "listar recurso",
      );
      return { ok: true, detail: "Conexion correcta." };
    } finally {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
