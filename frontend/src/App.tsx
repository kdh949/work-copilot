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
        <>
          {mode === "login" ? (
            <LoginForm onLoginSuccess={setLoginId} />
          ) : (
            <SignUpForm />
          )}

          {mode === "login" ? (
            <button type="button" onClick={() => setMode("signup")}>
              회원가입
            </button>
          ) : (
            <button type="button" onClick={() => setMode("login")}>
              로그인으로 돌아가기
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default App;
