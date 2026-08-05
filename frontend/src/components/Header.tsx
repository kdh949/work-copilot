import { useEffect, useRef, useState } from "react";
import { IconBrandJira, IconChevronDown, IconLogout } from "@tabler/icons-react";

type User = {
  id: number;
  email: string;
  nickname: string;
  department?: string | null;
  employeeNumber?: string | null;
  role: string;
};

export type MenuName =
  | "posts"
  | "notes"
  | "workBriefs"
  | "integrations"
  | "admin"
  | "login";

type HeaderProps = {
  title: string;
  menu: MenuName;
  user: User | null;
  onMenuClick: (menu: MenuName) => void;
  onLogout: () => void;
};

const NAV_ITEMS: { menu: MenuName; label: string }[] = [
  { menu: "posts", label: "회사 위키" },
  { menu: "notes", label: "내 노트" },
  { menu: "workBriefs", label: "업무 브리프" },
  { menu: "integrations", label: "내 연동" },
];

export function Header(props: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeProfile(event: MouseEvent) {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", closeProfile);
    return () => document.removeEventListener("mousedown", closeProfile);
  }, []);

  return (
    <header className="header">
      <button
        type="button"
        className="header-brand"
        onClick={() => props.user && props.onMenuClick("workBriefs")}
        aria-label={`${props.title} 홈`}
      >
        <span className="header-brand-mark" aria-hidden="true">
          <IconBrandJira size={20} stroke={2.1} />
        </span>
        <span>{props.title}</span>
      </button>

      {props.user ? (
        <>
          <nav aria-label="주요 메뉴">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.menu}
                className={props.menu === item.menu ? "active" : ""}
                onClick={() => props.onMenuClick(item.menu)}
                aria-current={props.menu === item.menu ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
            {props.user.role === "admin" ? (
              <button
                type="button"
                className={props.menu === "admin" ? "active" : ""}
                onClick={() => props.onMenuClick("admin")}
              >
                연동 관리
              </button>
            ) : null}
          </nav>

          <div className="header-actions">
            <div className="header-profile" ref={profileRef}>
              <button
                type="button"
                className="header-profile-trigger"
                onClick={() => setProfileOpen((current) => !current)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <span className="header-avatar" aria-hidden="true">
                  {props.user.nickname.trim().slice(0, 1) || "사"}
                </span>
                <span className="header-profile-name">{props.user.nickname}</span>
                <IconChevronDown size={16} />
              </button>
              {profileOpen ? (
                <div className="header-profile-menu" role="menu">
                  <strong>{props.user.nickname}</strong>
                  <span>{props.user.email}</span>
                  <span>{props.user.department || "부서 미등록"} · {props.user.employeeNumber || "사번 미등록"}</span>
                  <button type="button" role="menuitem" onClick={props.onLogout}>
                    <IconLogout size={17} /> 로그아웃
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
