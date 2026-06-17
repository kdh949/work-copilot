import { useState } from "react";
import BoardPage from "./BoardPage";
import LoginForm from "./LoginForm";
import SignUpForm from "./SignUpForm";
import "./App.css";

function App() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginId, setLoginId] = useState<string | null>(() => {
    const accessToken = localStorage.getItem("accessToken");
    const savedLoginId = localStorage.getItem("loginId");

    // 새로고침하면 React state는 초기화되므로, 브라우저 저장소에 남아 있는 로그인 정보를 읽어서 세션을 복원한다.
    return accessToken && savedLoginId ? savedLoginId : null;
  });

  function handleLogout() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("loginId");
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
