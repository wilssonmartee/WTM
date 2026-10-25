import { AuthProvider, useAuth } from "./state/auth";
import { Login } from "./screens/Login";
import { Desktop } from "./screens/Desktop";

function Shell() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="wtm-login">
        <div className="wtm-login__logo">W</div>
      </div>
    );
  }

  return user ? <Desktop /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
