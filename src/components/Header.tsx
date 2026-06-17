type User = {
    id: number;
    email: string;
    nickname: string;
    role: string;
};

export type MenuName = 'posts' | 'notes' | 'login' | 'signup';

type HeaderProps = {
    title: string;
    menu: MenuName;
    user: User | null;
    onMenuClick: (menu: MenuName) => void;
    onChatClick: () => void;
    onLogout: () => void;
};

export function Header(props: HeaderProps) {
    return (
        <header className="header">
            <h1>{props.title}</h1>

            <nav>
                <button type="button" className={props.menu === 'posts' ? 'active' : ''} onClick={() => props.onMenuClick('posts')}>
                    회사 위키
                </button>
                <button type="button" onClick={props.onChatClick}>
                    AI 챗봇
                </button>
                <button type="button" className={props.menu === 'notes' ? 'active' : ''} onClick={() => props.onMenuClick('notes')}>
                    내 노트
                </button>

                {props.user ? (
                    <>
                        <span>{props.user.nickname} · {props.user.role}</span>
                        <button type="button" onClick={props.onLogout}>
                            로그아웃
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className={props.menu === 'login' ? 'active' : ''} onClick={() => props.onMenuClick('login')}>
                            로그인
                        </button>
                        <button type="button" className={props.menu === 'signup' ? 'active' : ''} onClick={() => props.onMenuClick('signup')}>
                            회원가입
                        </button>
                    </>
                )}
            </nav>
        </header>
    );
}
