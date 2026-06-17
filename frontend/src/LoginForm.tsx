import React from "react";
import { apiUrl } from "./api";

type LoginFormProps = {
  onLoginSuccess: (loginId: string) => void;
  onSwitchToSignUp: () => void;
};

type FeatureIconName = "board" | "ai" | "knowledge";

function FeatureIcon({ name, label }: { name: FeatureIconName; label: string }) {
  const commonProps: React.SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    width: 19,
    height: 19,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: "img",
    "aria-label": label,
  };

  const icons: Record<FeatureIconName, React.ReactElement> = {
    board: (
      <svg {...commonProps}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    ),
    ai: (
      <svg {...commonProps}>
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m4.93 4.93 2.83 2.83" />
        <path d="m16.24 16.24 2.83 2.83" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <path d="m4.93 19.07 2.83-2.83" />
        <path d="m16.24 7.76 2.83-2.83" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    knowledge: (
      <svg {...commonProps}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M9 7h7" />
        <path d="M9 11h5" />
      </svg>
    ),
  };

  return <span className="card-icon">{icons[name]}</span>;
}

export const LoginForm = ({ onLoginSuccess, onSwitchToSignUp }: LoginFormProps) => {
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [message, setMessage] = React.useState("");

  const isDisabled = loginId === "" || password === "";

  async function handleLogin(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch(apiUrl("/users/login"), {
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
    <div className="auth-page">
      <header className="auth-brand">
        <span className="brand-mark" aria-hidden="true" />
        <strong>정글 AI 멘토</strong>
      </header>

      <main className="auth-layout">
        <section className="auth-intro">
          <span className="auth-eyebrow">Jungle AI Mentor</span>
          <h1>정글 학습을 위한 AI 멘토</h1>
          <p>게시판 질문, AI 답변, 지식베이스 근거를 한 흐름에서 이어가세요.</p>

          <div className="auth-feature-list">
            <article>
              <FeatureIcon name="board" label="게시판 아이콘" />
              <div>
                <strong>게시판 질문 정리</strong>
                <p>학습 중 생긴 질문과 답변을 태그로 모읍니다.</p>
              </div>
            </article>
            <article>
              <FeatureIcon name="ai" label="AI 아이콘" />
              <div>
                <strong>AI 답변과 참고 근거</strong>
                <p>RAG 검색과 저장소 분석 결과를 함께 확인합니다.</p>
              </div>
            </article>
            <article>
              <FeatureIcon name="knowledge" label="지식베이스 아이콘" />
              <div>
                <strong>지식베이스 자료 확인</strong>
                <p>FAQ, 블로그, GitHub, 게시판 근거를 살펴봅니다.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="auth-card">
          <form className="auth-form" onSubmit={handleLogin}>
            <div>
              <h2>로그인</h2>
              <p>계정으로 학습 기록과 AI 질문을 이어가세요.</p>
            </div>

            <label htmlFor="login-loginId-input">아이디</label>
            <input
              id="login-loginId-input"
              type="text"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder="아이디를 입력하세요"
            />

            <label htmlFor="login-password-input">비밀번호</label>
            <input
              id="login-password-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호를 입력하세요"
            />

            <button className="primary-action" type="submit" disabled={isDisabled}>
              로그인
            </button>

            <button className="auth-secondary-button" type="button" onClick={onSwitchToSignUp}>
              회원가입
            </button>

            <button className="auth-link-button" type="button">
              비밀번호를 잊으셨나요?
            </button>

            {message && <p className="auth-message">{message}</p>}
          </form>

          <div className="auth-preview-strip">
            <span>게시판</span>
            <span>AI 질문</span>
            <span>지식베이스</span>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LoginForm;
