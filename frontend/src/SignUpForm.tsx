import React from "react";

export const SignUpForm = () => {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [message, setMessage] = React.useState("");

  const isDisabled = loginId === "" || password === "";

  async function handleSignUp(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch("http://localhost:3000/users", {
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
      setMessage("회원가입 실패");
      return;
    }

    const user = await response.json();

    setMessage(`${user.loginId} 회원가입 성공`);
    setLoginId("");
    setPassword("");
  }

  return (
    <form onSubmit={handleSignUp}>
      <h2>회원가입</h2>

      <div>
        <label htmlFor="signup-loginId-input">LoginId:</label>
        <input
          id="signup-loginId-input"
          type="text"
          value={loginId}
          onChange={(event) => setLoginId(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="signup-password-input">Password:</label>
        <input
          id="signup-password-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <button type="submit" disabled={isDisabled}>
        회원가입
      </button>

      <p>{message}</p>
    </form>
  );
};

export default SignUpForm;
