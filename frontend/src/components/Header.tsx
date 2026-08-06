import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { IconBrandJira, IconChevronDown, IconLogout } from "@tabler/icons-react";
import { MENU_PATHS, type MenuName } from "../routes";

type User = {
  id: number;
  email: string;
  nickname: string;
  department?: string | null;
  employeeNumber?: string | null;
  role: string;
};

type HeaderProps = {
  title: string;
  user: User | null;
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
      {props.user ? (
        <Link
          to={MENU_PATHS.workBriefs}
          className="header-brand"
          aria-label={`${props.title} 홈`}
        >
          <span className="header-brand-mark" aria-hidden="true">
            <IconBrandJira size={20} stroke={2.1} />
          </span>
          <span>{props.title}</span>
        </Link>
      ) : (
        <span className="header-brand">
          <span className="header-brand-mark" aria-hidden="true">
            <IconBrandJira size={20} stroke={2.1} />
          </span>
          <span>{props.title}</span>
        </span>
      )}

      {props.user ? (
        <>
          {/* NavLink derives the active state from the URL, so the header can
              no longer disagree with the screen that is actually shown. */}
          <nav aria-label="주요 메뉴">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.menu}
                to={MENU_PATHS[item.menu]}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {item.label}
              </NavLink>
            ))}
            {props.user.role === "admin" ? (
              <NavLink
                to={MENU_PATHS.admin}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                연동 관리
              </NavLink>
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
