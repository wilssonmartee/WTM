import express, { type Response } from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { initDb } from "./db.js";
import {
  login,
  requireAuth,
  companiesForUser,
  userFromToken,
  type AuthedRequest,
} from "./auth.js";
import { runCommand, newTerminalSession } from "./terminal.js";
import { getAppearance, setAppearance } from "./appearance.js";
import {
  initRegistry,
  catalog,
  install,
  uninstall,
  moduleDispatcher,
} from "./modules/registry.js";
import * as updater from "./updater/service.js";
import { WTM_VERSION } from "@wtm/shared";

initDb();
initRegistry();
updater.startScheduler();

const app = express();
app.use(cors());
app.use(express.json());

// --- Salud / info publica ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, data: { status: "online", version: WTM_VERSION } });
});

// --- Autenticacion ---
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ ok: false, error: "Credenciales invalidas" });
    return;
  }
  const session = login(username, password);
  if (!session) {
    res.status(401).json({ ok: false, error: "Usuario o contrasena incorrectos" });
    return;
  }
  res.json({ ok: true, data: session });
});

app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  res.json({
    ok: true,
    data: { user, companies: companiesForUser(user.id) },
  });
});

// --- Modulos ---
// Catalogo completo con estado de instalacion (reales + placeholders).
app.get("/api/modules", requireAuth, (_req, res) => {
  res.json({ ok: true, data: catalog() });
});

// Gestion de paquetes (instalar / desinstalar). Solo superadmin.
app.post("/api/modules/:id/install", requireAuth, (req: AuthedRequest, res) => {
  if (req.user!.globalRole !== "superadmin") {
    res.status(403).json({ ok: false, error: "No autorizado" });
    return;
  }
  const r = install(req.params.id);
  if (!r.ok) {
    res.status(400).json({ ok: false, error: r.error });
    return;
  }
  res.json({ ok: true, data: catalog() });
});

app.post(
  "/api/modules/:id/uninstall",
  requireAuth,
  (req: AuthedRequest, res) => {
    if (req.user!.globalRole !== "superadmin") {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }
    const purge = req.query.purge === "true";
    const r = uninstall(req.params.id, purge);
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    res.json({ ok: true, data: catalog() });
  },
);

// Punto de montaje dinamico de los modulos instalados: /api/m/<id>/*
app.use("/api/m", moduleDispatcher());

// --- Actualizaciones (GitHub) --- solo superadmin ---
function requireSuperadmin(req: AuthedRequest, res: Response): boolean {
  if (req.user!.globalRole !== "superadmin") {
    res.status(403).json({ ok: false, error: "No autorizado" });
    return false;
  }
  return true;
}

app.get("/api/update/status", requireAuth, async (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  res.json({ ok: true, data: await updater.getStatus() });
});

app.get("/api/update/history", requireAuth, async (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  res.json({ ok: true, data: await updater.getHistory() });
});

app.get("/api/update/log", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  res.json({ ok: true, data: updater.getLog() });
});

app.put("/api/update/config", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  const cfg = updater.setConfig(req.body ?? {});
  updater.restartScheduler();
  res.json({ ok: true, data: cfg });
});

app.post("/api/update/check", requireAuth, async (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  res.json({ ok: true, data: await updater.check() });
});

app.post("/api/update/apply", requireAuth, async (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  res.json({ ok: true, data: await updater.update() });
});

app.post("/api/update/rollback", requireAuth, async (req: AuthedRequest, res) => {
  if (!requireSuperadmin(req, res)) return;
  const hash = req.body?.hash;
  if (typeof hash !== "string" || !hash) {
    res.status(400).json({ ok: false, error: "Falta el commit" });
    return;
  }
  res.json({ ok: true, data: await updater.rollback(hash) });
});

// --- Apariencia (la UI/estetica vive en el core) ---
// GET es publico: el login necesita el branding antes de autenticar.
app.get("/api/appearance", (_req, res) => {
  res.json({ ok: true, data: getAppearance() });
});

// Solo el superadmin puede cambiar la apariencia del sistema.
app.put("/api/appearance", requireAuth, (req: AuthedRequest, res) => {
  if (req.user!.globalRole !== "superadmin") {
    res.status(403).json({ ok: false, error: "No autorizado" });
    return;
  }
  const next = setAppearance(req.body ?? {});
  res.json({ ok: true, data: next });
});

// --- Servir el escritorio (cliente web) en produccion ---
// Si existe el bundle del desktop, el core lo sirve para que cualquier
// dispositivo con navegador entre por http://servidor sin instalar nada.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDist =
  process.env.WTM_DESKTOP_DIR ??
  path.resolve(__dirname, "..", "..", "desktop", "dist");

if (fs.existsSync(path.join(desktopDist, "index.html"))) {
  app.use(express.static(desktopDist));
  // SPA fallback: cualquier ruta que no sea /api devuelve el index.
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.sendFile(path.join(desktopDist, "index.html"));
  });
  console.log(`[web] Sirviendo escritorio desde ${desktopDist}`);
}

import os from "node:os";

const server = http.createServer(app);

/** Devuelve las IPs IPv4 no internas del host (para mostrarlas al arrancar). */
function localIPs(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// --- Terminal via WebSocket ---
const wss = new WebSocketServer({ server, path: "/ws/terminal" });

wss.on("connection", (socket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const user = userFromToken(token);
  if (!user) {
    socket.send(
      JSON.stringify({ type: "error", message: "No autenticado" }),
    );
    socket.close();
    return;
  }

  const session = newTerminalSession();
  socket.send(
    JSON.stringify({
      type: "welcome",
      cwd: session.cwd,
      message: `WTM ${WTM_VERSION} — terminal del sistema. Escribe 'help'.`,
      user: user.username,
    }),
  );

  socket.on("message", (data) => {
    let payload: { command?: string };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    const result = runCommand(user, session, payload.command ?? "");
    socket.send(JSON.stringify({ type: "result", ...result }));
  });
});

// --- WebSocket de eventos del sistema (recarga tras actualizar) ---
const systemWss = new WebSocketServer({ server, path: "/ws/system" });
updater.onReloadRequested((reason) => {
  const msg = JSON.stringify({ type: "system-reload", reason });
  for (const client of systemWss.clients) {
    try {
      client.send(msg);
    } catch {
      /* ignorar clientes caidos */
    }
  }
});

// Escuchar en 0.0.0.0 (todas las interfaces) para aceptar conexiones de otros
// equipos y de maquinas virtuales, no solo de localhost.
server.listen(config.port, "0.0.0.0", () => {
  console.log(`\n  WTM core ${WTM_VERSION}`);
  console.log(`  En esta maquina:  http://localhost:${config.port}`);
  for (const ip of localIPs()) {
    console.log(`  En la red:        http://${ip}:${config.port}`);
  }
  console.log(`  Datos:            ${config.dataDir}\n`);
});
