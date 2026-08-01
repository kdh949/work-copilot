type User = {
  id: number;
  email: string;
  nickname: string;
  department?: string | null;
  employeeNumber?: string | null;
  role: string;
};

export type MenuName = "posts" | "notes" | "login";

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
        {props.user ? (
          <>
            <button
              type="button"
              className={props.menu === "posts" ? "active" : ""}
              onClick={() => props.onMenuClick("posts")}
            >
              회사 위키
            </button>
            <button
              type="button"
              className={props.menu === "notes" ? "active" : ""}
              onClick={() => props.onMenuClick("notes")}
            >
              내 노트
            </button>
            <span>
              {props.user.nickname} · {props.user.department || "부서 미등록"} ·{" "}
              {props.user.employeeNumber || "사번 미등록"} · {props.user.role}
            </span>
            <button type="button" onClick={props.onLogout}>
              로그아웃
            </button>
          </>
        ) : null}
      </nav>
    </header>
  );
}
