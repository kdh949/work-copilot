import { useState } from "react";
import BoardPage from "./BoardPage";
import LoginForm from "./LoginForm";
import SignUpForm from "./SignUpForm";
import "./App.css";

function App() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState<string | null>(null);

  function handleLogout() {
    localStorage.removeItem("accessToken");
    setLoginId(null);
    setMode("login");
  }

  return (
    <div>
      {loginId ? (
        <BoardPage loginId={loginId} onLogout={handleLogout} />
      ) : (
        mode === "login" ? (
          <LoginForm
            onLoginSuccess={setLoginId}
            onSwitchToSignUp={() => setMode("signup")}
          />
        ) : (
          <SignUpForm onSwitchToLogin={() => setMode("login")} />
        )
      )}
    </div>
  );
}

export default App;
