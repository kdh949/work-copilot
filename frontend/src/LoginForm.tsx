import React from "react";

type LoginFormProps = {
  onLoginSuccess: (loginId: string) => void;
};

export const LoginForm = ({ onLoginSuccess }: LoginFormProps) => {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [message, setMessage] = React.useState("");

  const isDisabled = loginId === "" || password === "";

  async function handleLogin(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch("http://localhost:3000/users/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        loginId,
        password,
      }),
    });

    if (!response.ok) {
      setMessage("로그인 실패");
      return;
    }

    const data = await response.json();

    localStorage.setItem("accessToken", data.accessToken);

    onLoginSuccess(data.user.loginId);
    setLoginId("");
    setPassword("");
  }

  return (
    <form onSubmit={handleLogin}>
      <h2>로그인</h2>

      <div>
        <label htmlFor="login-loginId-input">LoginId:</label>
        <input
          id="login-loginId-input"
          type="text"
          value={loginId}
          onChange={(event) => setLoginId(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="login-password-input">Password:</label>
        <input
          id="login-password-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <button type="submit" disabled={isDisabled}>
        로그인
      </button>

      <p>{message}</p>
    </form>
  );
};

export default LoginForm;
