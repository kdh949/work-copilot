type User = {
    id: number;
    email: string;
    nickname: string;
};

export type MenuName = 'posts' | 'questions' | 'login' | 'signup';

type HeaderProps = {
    title: string;
    menu: MenuName;
    user: User | null;
    onMenuClick: (menu: MenuName) => void;
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
                <button type="button" className={props.menu === 'questions' ? 'active' : ''} onClick={() => props.onMenuClick('questions')}>
                    내 질문 노트
                </button>

                {props.user ? (
                    <>
                        <span>{props.user.nickname}</span>
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
