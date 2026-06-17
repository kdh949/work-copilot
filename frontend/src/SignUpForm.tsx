import React from "react";
import { apiUrl } from "./api";

const HTTP_STATUS_CONFLICT = 409;

type SignUpFormProps = {
  onSwitchToLogin: () => void;
};

export const SignUpForm = ({ onSwitchToLogin }: SignUpFormProps) => {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [message, setMessage] = React.useState("");

  const isDisabled = loginId === "" || password === "";

  async function handleSignUp(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch(apiUrl("/users"), {
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
      const error = await response.json();
      if (response.status === HTTP_STATUS_CONFLICT) {
        setMessage(error.message);
        return;
      }

      setMessage("회원가입 실패");
      return;
    }

    const user = await response.json();

    setMessage(`${user.loginId} 회원가입 성공`);
    setLoginId("");
    setPassword("");
  }

  return (
    <div className="auth-page">
      <header className="auth-brand">
        <span className="brand-mark" aria-hidden="true" />
        <strong>정글 AI 멘토</strong>
      </header>

      <main className="auth-layout">
        <section className="auth-intro">
          <span className="auth-eyebrow">Start Learning</span>
          <h1>학습 기록을 남기고 AI 멘토와 이어가세요</h1>
          <p>가입 후 게시판, AI 질문, 지식베이스 기능을 같은 계정으로 사용할 수 있습니다.</p>

          <div className="auth-feature-list">
            <article>
              <span className="card-icon">질</span>
              <div>
                <strong>질문을 남기기</strong>
                <p>정글 학습 중 막힌 지점을 게시판에 기록합니다.</p>
              </div>
            </article>
            <article>
              <span className="card-icon">근</span>
              <div>
                <strong>근거 기반 답변 받기</strong>
                <p>AI 답변과 참고 자료를 함께 확인합니다.</p>
              </div>
            </article>
            <article>
              <span className="card-icon">저</span>
              <div>
                <strong>내 활동 저장</strong>
                <p>내 글, 댓글, AI 질문 이력을 한 곳에서 봅니다.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="auth-card">
          <form className="auth-form" onSubmit={handleSignUp}>
            <div>
              <h2>회원가입</h2>
              <p>아이디와 비밀번호만으로 빠르게 시작하세요.</p>
            </div>

            <label htmlFor="signup-loginId-input">아이디</label>
            <input
              id="signup-loginId-input"
              type="text"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder="사용할 아이디를 입력하세요"
            />

            <label htmlFor="signup-password-input">비밀번호</label>
            <input
              id="signup-password-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호를 입력하세요"
            />

            <button className="primary-action" type="submit" disabled={isDisabled}>
              회원가입
            </button>

            <button className="auth-secondary-button" type="button" onClick={onSwitchToLogin}>
              로그인으로 돌아가기
            </button>

            {message && <p className="auth-message">{message}</p>}
          </form>

          <div className="auth-preview-strip">
            <span>게시판</span>
            <span>AI 질문</span>
            <span>내 활동</span>
          </div>
        </section>
      </main>
    </div>
  );
};

export default SignUpForm;
