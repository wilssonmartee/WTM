import { Router, raw } from "express";
import zlib from "node:zlib";
import path from "node:path";
import fs from "node:fs";
import type { WtmModule, ModuleContext } from "./types.js";
import { requireAuth, requireLevel } from "../auth.js";
import { config as coreConfig } from "../config.js";
import { encryptSecret, decryptSecret } from "../crypto.js";
import {
  smbReadFile,
  smbTest,
  type SmbConnection,
} from "./smb.js";

/**
 * Modulo Articulos.
 *
 * El DBF vive en un servidor Samba (SMB) de la red del cliente. El CORE se
 * conecta a ese recurso compartido y lee el archivo directamente; el cliente
 * solo configura la conexion (host, share, usuario, contrasena, dominio y la
 * ruta del DBF dentro del share) y pulsa Actualizar.
 *
 * Al leer, el core guarda una copia COMPRIMIDA (gzip) en disco como cache, para
 * que al abrir el modulo los datos aparezcan de inmediato sin tocar la red.
 *
 * - Config de presentacion (columnas/alias/orden/encoding): settings.
 * - Config de conexion SMB (contrasena cifrada): settings.
 * - DBF comprimido (cache): data/modules/articulos/store.dbf.gz
 */
const CONFIG_KEY = "module.articulos.config";
const SMB_KEY = "module.articulos.smb";

function storeDir(): string {
  const dir = path.join(coreConfig.dataDir, "modules", "articulos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function storePath(): string {
  return path.join(storeDir(), "store.dbf.gz");
}

/** Forma de la conexion SMB tal como se guarda (contrasena cifrada). */
interface StoredSmb {
  host: string;
  share: string;
  username: string;
  password: string; // cifrada (enc$...) salvo compat
  domain: string;
  dbfPath: string; // ruta del DBF dentro del share
}

export const articulosModule: WtmModule = {
  manifest: {
    id: "articulos",
    name: "Articulos",
    version: "0.2.0",
    description:
      "Lee un DBF desde un servidor Samba (SMB): columnas, orden y busqueda (con tildes y enies).",
    icon: "boxes",
    color: "#3f7d8c",
    dataScope: "shared",
    status: "available",
    category: "inventario",
    // Cliente SMB para Node. Usamos @tryjsky/v9u-smb2 (fork de marsaud con
    // parche para Node 17+/OpenSSL 3: @marsaud/smb2 falla con
    // ERR_OSSL_EVP_UNSUPPORTED al generar el hash NTLM con DES). El gestor de
    // dependencias lo instala al instalar el modulo y lo quita al purgar si
    // ningun otro modulo lo usa.
    npmDependencies: { "@tryjsky/v9u-smb2": "^1.1.0" },
  },

  migrate() {
    // Sin tablas: la config vive en settings.
  },

  drop(db) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(CONFIG_KEY);
    db.prepare("DELETE FROM settings WHERE key = ?").run(SMB_KEY);
    // Al purgar, borramos tambien el DBF cacheado.
    try {
      fs.rmSync(storeDir(), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  },

  createRouter(ctx: ModuleContext): Router {
    const router = Router();
    router.use(requireAuth, requireLevel("articulos", 1));

    function readSetting<T>(key: string): T | null {
      const row = ctx.db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(key) as { value: string } | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return null;
      }
    }
    function writeSetting(key: string, value: unknown): void {
      ctx.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(key, JSON.stringify(value));
    }

    function loadSmb(): StoredSmb | null {
      return readSetting<StoredSmb>(SMB_KEY);
    }
    /** Conexion lista para usar (contrasena descifrada). */
    function smbConnection(s: StoredSmb): SmbConnection {
      return {
        host: s.host,
        share: s.share,
        username: s.username,
        password: s.password ? decryptSecret(s.password) : "",
        domain: s.domain,
      };
    }

    // ================= Config de presentacion =================
    router.get("/config", (_req, res) => {
      const data = readSetting<unknown>(CONFIG_KEY);
      let stored: { size: number; at: string } | null = null;
      try {
        const st = fs.statSync(storePath());
        stored = { size: st.size, at: st.mtime.toISOString() };
      } catch {
        stored = null;
      }
      res.json({ ok: true, data, stored });
    });

    router.put("/config", requireLevel("articulos", 2), (req, res) => {
      writeSetting(CONFIG_KEY, req.body ?? {});
      res.json({ ok: true, data: req.body ?? {} });
    });

    // ================= Config de conexion SMB =================
    // Nunca devolvemos la contrasena en claro: solo si hay una guardada.
    router.get("/smb/config", (_req, res) => {
      const s = loadSmb();
      res.json({
        ok: true,
        data: s
          ? {
              host: s.host,
              share: s.share,
              username: s.username,
              domain: s.domain,
              dbfPath: s.dbfPath,
              hasPassword: !!s.password,
            }
          : null,
      });
    });

    // Guardar conexion. La contrasena se cifra. Si llega vacia y ya habia una
    // guardada, se conserva la anterior (para no obligar a reescribirla).
    router.put("/smb/config", requireLevel("articulos", 2), (req, res) => {
      const b = (req.body ?? {}) as Partial<StoredSmb> & {
        password?: string;
      };
      if (!b.host || !b.share) {
        res
          .status(400)
          .json({ ok: false, error: "Host y recurso compartido son obligatorios" });
        return;
      }
      const prev = loadSmb();
      let password = prev?.password ?? "";
      if (typeof b.password === "string" && b.password.length > 0) {
        password = encryptSecret(b.password);
      }
      const next: StoredSmb = {
        host: b.host.trim(),
        share: b.share.trim(),
        username: (b.username ?? "").trim(),
        password,
        domain: (b.domain ?? "").trim(),
        dbfPath: (b.dbfPath ?? "").trim(),
      };
      writeSetting(SMB_KEY, next);
      res.json({
        ok: true,
        data: {
          host: next.host,
          share: next.share,
          username: next.username,
          domain: next.domain,
          dbfPath: next.dbfPath,
          hasPassword: !!next.password,
        },
      });
    });

    // Probar conexion (opcionalmente con una conexion aun no guardada).
    router.post("/smb/test", requireLevel("articulos", 2), async (req, res) => {
      const b = (req.body ?? {}) as Partial<StoredSmb> & { password?: string };
      const prev = loadSmb();
      // Si no mandan contrasena en la prueba, usamos la guardada (descifrada).
      const password =
        typeof b.password === "string" && b.password.length > 0
          ? b.password
          : prev?.password
            ? decryptSecret(prev.password)
            : "";
      const conn: SmbConnection = {
        host: (b.host ?? prev?.host ?? "").trim(),
        share: (b.share ?? prev?.share ?? "").trim(),
        username: (b.username ?? prev?.username ?? "").trim(),
        password,
        domain: (b.domain ?? prev?.domain ?? "").trim(),
      };
      if (!conn.host || !conn.share) {
        res.status(400).json({ ok: false, error: "Faltan host o recurso" });
        return;
      }
      const probe = (b.dbfPath ?? prev?.dbfPath ?? "").trim();
      const r = await smbTest(conn, probe);
      res.json({ ok: true, data: r });
    });

    // ================= Leer el DBF desde SMB =================
    // Lee el archivo del share, actualiza la cache gzip y devuelve los bytes
    // gzip al cliente (que los parsea en el navegador, igual que antes).
    router.get("/smb/read", async (_req, res) => {
      const s = loadSmb();
      if (!s || !s.host || !s.share) {
        res
          .status(400)
          .json({ ok: false, error: "No hay conexion SMB configurada" });
        return;
      }
      if (!s.dbfPath) {
        res
          .status(400)
          .json({ ok: false, error: "No se configuro la ruta del DBF" });
        return;
      }
      try {
        const raw = await smbReadFile(smbConnection(s), s.dbfPath);
        const gz = zlib.gzipSync(raw);
        // Actualizamos la cache en disco.
        try {
          fs.writeFileSync(storePath(), gz);
        } catch {
          /* la cache es best-effort */
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Encoding", "identity"); // gzip propio, no HTTP
        res.send(gz);
      } catch (e) {
        res.status(502).json({
          ok: false,
          error: "No se pudo leer el DBF por SMB: " + (e as Error).message,
        });
      }
    });

    // ================= Cache gzip (compatibilidad) =================
    // Descargar la ultima copia cacheada (para mostrar datos al abrir sin red).
    router.get("/data", (_req, res) => {
      const p = storePath();
      if (!fs.existsSync(p)) {
        res.status(404).json({ ok: false, error: "No hay DBF en cache" });
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Encoding", "identity");
      fs.createReadStream(p).pipe(res);
    });

    // Subida manual (se conserva por compatibilidad con clientes previos).
    router.put(
      "/data",
      requireLevel("articulos", 2),
      raw({ type: "application/octet-stream", limit: "200mb" }),
      (req, res) => {
        const body = req.body as Buffer;
        if (!body || !body.length) {
          res.status(400).json({ ok: false, error: "Sin datos" });
          return;
        }
        try {
          fs.writeFileSync(storePath(), body);
          res.json({
            ok: true,
            data: { size: body.length, at: new Date().toISOString() },
          });
        } catch (e) {
          res.status(500).json({ ok: false, error: (e as Error).message });
        }
      },
    );

    return router;
  },
};
