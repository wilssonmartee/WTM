import { useState } from "react";
import { useAuth } from "../state/auth";
import {
  getServerUrl,
  setServerUrl,
  isNativeApp,
  hasStoredServer,
} from "../lib/config";

export function Login() {
  const { login, appearance } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // En la app nativa, si aun no hay servidor guardado, mostramos el campo
  // para que el usuario elija a que core conectarse.
  const [showServer, setShowServer] = useState(
    isNativeApp() && !hasStoredServer(),
  );
  const [server, setServer] = useState(getServerUrl());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (showServer) setServerUrl(server);
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wtm-login">
      <form className="wtm-login__card" onSubmit={submit}>
        <div className="wtm-login__logo">{appearance.logoText}</div>
        <h1>{appearance.systemName}</h1>
        <p>{appearance.tagline}</p>

        <div className="wtm-field">
          <label>Usuario</label>
          <input
            className="wtm-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="wtm-field">
          <label>Contrasena</label>
          <input
            className="wtm-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {showServer && (
          <div className="wtm-field">
            <label>Servidor</label>
            <input
              className="wtm-input"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://servidor:4000"
            />
          </div>
        )}

        <p className="wtm-error">{error}</p>

        <button className="wtm-btn" disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </button>

        {/* "Cambiar servidor" solo tiene sentido en la app nativa; en web el
            core siempre es el mismo origen de la pagina. */}
        {isNativeApp() && (
          <button
            type="button"
            className="wtm-link"
            onClick={() => setShowServer((s) => !s)}
          >
            {showServer ? "Ocultar servidor" : "Cambiar servidor"}
          </button>
        )}

        <div className="wtm-hint">
          Acceso de prueba: <code>admin</code> / <code>admin</code>
          <br />
          Usuario demo: <code>juan</code> / <code>juan</code>
        </div>
      </form>
    </div>
  );
}
