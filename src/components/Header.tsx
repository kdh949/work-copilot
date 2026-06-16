export function Header() {
    return (
        <header>
            <h1>DH Board</h1>
            <nav>
                <a href="/posts">게시글</a>
                {' | '}
                <a href="/login">로그인</a>
                {' | '}
                <a href="/signup">회원가입</a>
            </nav>
        </header>
    );
}