/*
 * Logica del cascaron nativo WTM (thin client).
 *
 * Responsabilidad unica: elegir servidor y autenticar. Tras un login valido,
 * navega la ventana al escritorio servido por el core, pasando el token.
 * A partir de ahi, TODA la UI vive en el core.
 */

const LS_SERVER = "wtm.shell.serverUrl";

const $ = (id) => document.getElementById(id);
const serverEl = $("server");
const userEl = $("username");
const passEl = $("password");
const errEl = $("error");
const submitEl = $("submit");
const rememberEl = $("remember");
const serverStatusEl = $("serverStatus");

// Restaurar ultimo servidor usado.
serverEl.value = localStorage.getItem(LS_SERVER) || "http://localhost:4000";

function normalizeUrl(raw) {
  let url = (raw || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  return url;
}

// Chequeo de salud del servidor (feedback en vivo mientras se escribe).
let healthTimer = null;
async function checkHealth() {
  const url = normalizeUrl(serverEl.value);
  serverStatusEl.textContent = "";
  serverStatusEl.className = "status";
  if (!url) return;
  serverStatusEl.textContent = "comprobando...";
  try {
    const res = await fetch(url + "/api/health", { method: "GET" });
    const body = await res.json();
    if (body.ok) {
      serverStatusEl.textContent = `conectado · WTM ${body.data.version}`;
      serverStatusEl.className = "status ok";
    } else {
      throw new Error("respuesta invalida");
    }
  } catch {
    serverStatusEl.textContent = "no se pudo conectar";
    serverStatusEl.className = "status bad";
  }
}
serverEl.addEventListener("input", () => {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(checkHealth, 500);
});
checkHealth();

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";
  const url = normalizeUrl(serverEl.value);
  if (!url) {
    errEl.textContent = "Indica el servidor.";
    return;
  }
  submitEl.disabled = true;
  submitEl.textContent = "Entrando...";
  try {
    const res = await fetch(url + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: userEl.value,
        password: passEl.value,
      }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || "Error de autenticacion");

    if (rememberEl.checked) localStorage.setItem(LS_SERVER, url);
    else localStorage.removeItem(LS_SERVER);

    // Navegar al escritorio servido por el core, pasando el token.
    // El escritorio lo detecta en la URL y omite su propio login.
    const token = encodeURIComponent(body.data.token);
    window.location.href = `${url}/?token=${token}`;
  } catch (err) {
    errEl.textContent =
      err && err.message ? err.message : "No se pudo iniciar sesion";
  } finally {
    submitEl.disabled = false;
    submitEl.textContent = "Entrar";
  }
});
