import { useState } from "react";
import BoardPage from "./BoardPage";
import LoginForm from "./LoginForm";
import SignUpForm from "./SignUpForm";
import "./App.css";

function App() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState<string | null>(null);

  function handleLogout() {
    setLoginId(null);
    setMode("login");
  }

  return (
    <div>
      {loginId ? (
        <>
          <div className="user-menu">
            <p>{loginId}님 환영합니다</p>
            <button type="button" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
          <BoardPage loginId={loginId} />
        </>
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
