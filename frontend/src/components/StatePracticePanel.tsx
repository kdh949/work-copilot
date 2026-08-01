import { useState, type ChangeEvent, type FormEvent } from "react";

export function StatePracticePanel() {
    const [count, setCount] = useState(0);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    function handleIncreaseClick() {
        setCount(count + 1);
    }

    function handleEmailChange(event: ChangeEvent<HTMLInputElement>) {
        setEmail(event.target.value);
    }

    function handlePasswordChange(event: ChangeEvent<HTMLInputElement>) {
        setPassword(event.target.value);
    }

    function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
        setTitle(event.target.value);
    }

    function handleContentChange(event: ChangeEvent<HTMLTextAreaElement>) {
        setContent(event.target.value);
    }

    function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); // 브라우저 기본 동작 막음

        alert(`로그인 시도
이메일: ${email}
비밀번호: ${password}`);
    }

    function handlePostSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        alert(`게시글 작성 시도
제목: ${title}
내용: ${content}`);
    }

    return (
        <section>
            <section className="practice-card">
                <h3>카운터 상태 연습</h3>
                <p>현재 숫자: {count}</p>

                <button type="button" onClick={handleIncreaseClick}>
                    1 증가
                </button>
            </section>
            <section className="practice-card">
                <h3>로그인 폼 상태 연습</h3>

                <form onSubmit={handleLoginSubmit}>
                    <div>
                        <label htmlFor="login-email">이메일</label>
                        <input
                            id="login-email"
                            type="email"
                            value={email}
                            onChange={handleEmailChange}
                        />
                    </div>

                    <div>
                        <label htmlFor="login-password">비밀번호</label>
                        <input
                            id="login-password"
                            type="password"
                            value={password}
                            onChange={handlePasswordChange}
                        />
                    </div>

                    <button type="submit">로그인 시도</button>
                </form>
            </section>

            <section className="practice-card">
                <h3>게시글 작성 폼 상태 연습</h3>

                <form onSubmit={handlePostSubmit}>
                    <div>
                        <label htmlFor="post-title">제목</label>
                        <input
                            id="post-title"
                            type="text"
                            value={title}
                            onChange={handleTitleChange}
                        />
                    </div>

                    <div>
                        <label htmlFor="post-content">내용</label>
                        <textarea
                            id="post-content"
                            value={content}
                            onChange={handleContentChange}
                        />
                    </div>

                    <button type="submit">게시글 작성 시도</button>
                </form>
            </section>
        </section>


    );
}
