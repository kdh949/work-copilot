/**
 * The single mapping between a screen and its URL.
 *
 * Before this module the visible screen lived in an `App` state value, so a
 * reload or a shared link always landed on the login screen and any work in
 * progress was unreachable.  The URL is now the only source of truth for
 * "which screen am I on"; `MenuName` survives only as the name of a route so
 * the existing screen conditions keep reading the same way.
 */
export type MenuName =
  | "posts"
  | "notes"
  | "workBriefs"
  | "integrations"
  | "admin"
  | "login";

export const MENU_PATHS: Record<MenuName, string> = {
  login: "/login",
  posts: "/wiki",
  notes: "/notes",
  workBriefs: "/briefs",
  integrations: "/integrations",
  admin: "/admin",
};

/** Design-QA fixture screen. Never routed outside a development build. */
export const BRIEFS_PREVIEW_PATH = "/dev/briefs-preview";

const MENU_BY_PATH = Object.entries(MENU_PATHS).map(
  ([menu, path]) => [path, menu as MenuName] as const,
);

/**
 * Resolve a pathname to the screen it shows, or null when nothing matches.
 *
 * A draft path such as `/briefs/<id>` resolves to the same screen as
 * `/briefs`; the id is read by the briefs screen itself. Matching is on whole
 * segments so `/briefsomething` does not resolve to the briefs screen.
 *
 * The development preview path is deliberately absent: it must not resolve to
 * a real screen in a production build.
 */
export function menuFromPathname(pathname: string): MenuName | null {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  for (const [path, menu] of MENU_BY_PATH) {
    if (normalized === path || normalized.startsWith(`${path}/`)) {
      return menu;
    }
  }

  return null;
}

/** The draft id in `/briefs/<id>`, or null on the collection path. */
export function draftIdFromPathname(pathname: string): string | null {
  const prefix = `${MENU_PATHS.workBriefs}/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const [draftId] = pathname.slice(prefix.length).split("/");

  return draftId || null;
}
