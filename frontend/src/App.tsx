import {
  useEffect,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Header, type MenuName } from "./components/Header";
import {
  Alert,
  Badge,
  Button,
  Card,
  Select,
  TextArea,
  TextInput,
} from "./design-system/components";
import { IntegrationProfilesPage } from "./features/admin/IntegrationProfilesPage";
import { IntegrationConnectionsPage } from "./features/integrations/IntegrationConnectionsPage";
import { WorkBriefsPage } from "./features/work-briefs/WorkBriefsPage";
import {
  previewWorkBriefRequest,
  WORK_BRIEF_PREVIEW_EVIDENCE,
  WORK_BRIEF_PREVIEW_ISSUE,
  WORK_BRIEF_PREVIEW_USER,
} from "./features/work-briefs/work-briefs.preview";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const CHAT_SUGGESTIONS = [
  "입사 첫날 해야 할 일",
  "급여일과 휴가 규정",
  "우리 부서 온보딩",
  "필요한 계정 신청",
];
const WIKI_PAGE_SIZE = 12;
let csrfToken = "";
const IS_WORK_BRIEF_PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "work-brief";

type IntegrationProvider = "jira" | "confluence";
type IntegrationCallbackStatus =
  | "connected"
  | "provider_rejected"
  | "configuration_required"
  | "authorization_code_rejected"
  | "scope_configuration_required"
  | "oauth_request_rejected"
  | "provider_network_rejected"
  | "token_exchange_failed";

type User = {
  id: number;
  email: string;
  nickname: string;
  department?: string | null;
  employeeNumber?: string | null;
  role: string;
};

type Comment = {
  id: number;
  content: string;
  isAi: boolean;
  author: User | null;
  createdAt: string;
};

type BoardPost = {
  id: number;
  title: string;
  content: string;
  boardType: string;
  department: string;
  sourceId?: string | null;
  wikiPath?: string[] | null;
  parentSourceId?: string | null;
  depth?: number;
  docType?: string | null;
  summary?: string | null;
  tags: string[];
  author: User;
  comments?: Comment[];
  createdAt: string;
};

type PostListResponse = {
  items: BoardPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type AiResponse = {
  answer: string;
  searchMode?: string;
  department?: string | null;
  sources?: {
    sourceId: string;
    title: string;
    department: string;
    postId?: number | null;
  }[];
};

type WikiTreeNode = {
  path: string[];
  name: string;
  depth: number;
  documentCount: number;
};

type WikiTreeBranch = WikiTreeNode & {
  children: WikiTreeBranch[];
};

function getPostDepartment(post: BoardPost) {
  return post.department || "개인";
}

function getPathKey(path: string[]) {
  return path.join(" / ");
}

function getAncestorPathKeys(path: string[]) {
  const keys: string[] = [];

  for (let index = 0; index < path.length; index += 1) {
    keys.push(getPathKey(path.slice(0, index + 1)));
  }

  return keys;
}

function integrationCallbackErrorMessage(
  provider: IntegrationProvider,
  status: IntegrationCallbackStatus,
) {
  const providerName = provider === "jira" ? "Jira" : "Confluence";

  switch (status) {
    case "provider_rejected":
      return `${providerName} OAuth 요청이 거절되었습니다. Application Link의 Redirect URL과 READ 권한을 확인한 뒤 다시 연결하세요.`;
    case "configuration_required":
      return `${providerName}가 Client ID 또는 Client Secret을 거절했습니다. Incoming OAuth 2.0 링크에서 발급한 값을 연동 프로필에 다시 저장한 뒤 새로 연결하세요.`;
    case "authorization_code_rejected":
      return `${providerName} 인증 코드가 만료되었거나 이미 사용되었습니다. 연결을 다시 눌러 새 동의 절차를 완료하세요.`;
    case "scope_configuration_required":
      return `${providerName} OAuth scope가 Incoming OAuth 2.0 링크의 허용 범위와 일치하지 않습니다. 링크와 연동 프로필 모두에 READ 권한을 설정한 뒤 다시 연결하세요.`;
    case "oauth_request_rejected":
      return `${providerName}가 토큰 교환 요청을 거절했습니다. 연결을 새로 시작하고, 반복되면 Incoming OAuth 2.0 링크의 Redirect URL과 Client ID를 확인하세요.`;
    case "provider_network_rejected":
      return `${providerName} 네트워크 경계가 서버의 토큰 요청을 차단했습니다. 관리자에게 WAF 허용 상태를 확인해 달라고 요청하세요.`;
    case "token_exchange_failed":
      return `${providerName} 연결을 완료하지 못했습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 문의하세요.`;
    default:
      return "";
  }
}

function App() {
  const [menu, setMenu] = useState<MenuName>(IS_WORK_BRIEF_PREVIEW ? "workBriefs" : "login");
  const [user, setUser] = useState<User | null>(IS_WORK_BRIEF_PREVIEW ? WORK_BRIEF_PREVIEW_USER : null);
  const [message, setMessage] = useState("");

  const [wikiPosts, setWikiPosts] = useState<BoardPost[]>([]);
  const [wikiTreeNodes, setWikiTreeNodes] = useState<WikiTreeNode[]>([]);
  const [selectedWikiPath, setSelectedWikiPath] = useState<string[]>([]);
  const [selectedWikiDetail, setSelectedWikiDetail] =
    useState<BoardPost | null>(null);
  const [wikiPage, setWikiPage] = useState(1);
  const [wikiTotal, setWikiTotal] = useState(0);
  const [wikiTotalPages, setWikiTotalPages] = useState(1);
  const [notes, setNotes] = useState<BoardPost[]>([]);
  const [selectedWikiId, setSelectedWikiId] = useState<number | null>(null);
  const [selectedNoteViewId, setSelectedNoteViewId] = useState<number | null>(
    null,
  );
  const [openedWikiPaths, setOpenedWikiPaths] = useState<string[]>([]);
  const [openedNoteDepartments, setOpenedNoteDepartments] = useState<string[]>(
    [],
  );

  const [keyword, setKeyword] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [postTitle, setPostTitle] = useState("");
  const [postContent, setPostContent] = useState("");
  const [postDepartment, setPostDepartment] = useState("공통");
  const [postTags, setPostTags] = useState("");

  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteDepartment, setNoteDepartment] = useState("공통");
  const [noteTags, setNoteTags] = useState("");

  const [commentText, setCommentText] = useState<Record<number, string>>({});

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatSignalVisible, setIsChatSignalVisible] = useState(true);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatSubmittedQuestion, setChatSubmittedQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatSources, setChatSources] = useState<AiResponse["sources"]>([]);
  const [chatNoteTitle, setChatNoteTitle] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [chatError, setChatError] = useState("");

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (
      !["GET", "HEAD", "OPTIONS"].includes(
        (options.method ?? "GET").toUpperCase(),
      )
    ) {
      headers.set("x-csrf-token", csrfToken);
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = Array.isArray(data.message)
        ? data.message.join(", ")
        : data.message;
      const error = new Error(
        errorMessage || "요청 처리에 실패했습니다.",
      ) as Error & {
        status?: number;
        code?: string;
        detailCode?: string;
        correlationId?: string;
      };
      error.status = response.status;
      if (typeof data.code === "string") error.code = data.code;
      if (typeof data.detailCode === "string") {
        error.detailCode = data.detailCode;
      }
      if (typeof data.correlationId === "string") {
        error.correlationId = data.correlationId;
      }
      throw error;
    }

    return data as T;
  }

  async function refreshCsrfToken() {
    const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));

    if (
      !response.ok ||
      typeof data.csrfToken !== "string" ||
      data.csrfToken.length === 0
    ) {
      throw new Error("세션 보안 토큰을 갱신하지 못했습니다.");
    }

    csrfToken = data.csrfToken;
  }

  function clearClientSession() {
    csrfToken = "";
    setUser(null);
    setNotes([]);
    setIsChatOpen(false);
    setMenu("login");
  }

  function showError(error: unknown) {
    if (error instanceof Error) {
      setMessage(error.message);
      return;
    }

    setMessage("오류가 발생했습니다.");
  }

  async function loadWikiPosts() {
    try {
      const params = new URLSearchParams();
      params.set("page", String(wikiPage));
      params.set("limit", String(WIKI_PAGE_SIZE));

      for (const segment of selectedWikiPath) {
        params.append("path", segment);
      }

      if (keyword) {
        params.set("keyword", keyword);
      }
      if (tagFilter) {
        params.set("tag", tagFilter);
      }

      const data = await request<PostListResponse>(
        `/posts/wiki?${params.toString()}`,
      );
      setWikiPosts(data.items);
      setWikiTotal(data.total);
      setWikiTotalPages(data.totalPages || 1);

      if (data.items.length > 0) {
        setSelectedWikiId((currentId) => {
          if (currentId && data.items.some((item) => item.id === currentId)) {
            return currentId;
          }

          return null;
        });
      } else {
        setSelectedWikiId(null);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function loadWikiDetail(
    postId: number,
    options: { syncPath?: boolean } = {},
  ) {
    try {
      const post = await request<BoardPost>(`/posts/${postId}`);
      setSelectedWikiId(post.id);
      setSelectedWikiDetail(post);

      if (options.syncPath && post.wikiPath && post.wikiPath.length > 0) {
        setSelectedWikiPath(post.wikiPath);
        setWikiPage(1);
        setOpenedWikiPaths((paths) => {
          const nextPaths = [...paths];

          for (const pathKey of getAncestorPathKeys(post.wikiPath || [])) {
            if (!nextPaths.includes(pathKey)) {
              nextPaths.push(pathKey);
            }
          }

          return nextPaths;
        });
      }
    } catch (error) {
      showError(error);
    }
  }

  async function loadNotes() {
    if (!user) {
      setNotes([]);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");

      if (keyword) {
        params.set("keyword", keyword);
      }
      if (departmentFilter) {
        params.set("department", departmentFilter);
      }
      if (tagFilter) {
        params.set("tag", tagFilter);
      }

      const data = await request<PostListResponse>(
        `/posts/notes/my?${params.toString()}`,
      );
      setNotes(data.items);

      if (data.items.length > 0) {
        const firstPost = data.items[0];
        const firstDepartment = getPostDepartment(firstPost);

        setSelectedNoteViewId((currentId) => {
          if (currentId && data.items.some((item) => item.id === currentId)) {
            return currentId;
          }

          return firstPost.id;
        });

        setOpenedNoteDepartments((departments) => {
          if (departments.includes(firstDepartment)) {
            return departments;
          }

          return [...departments, firstDepartment];
        });

        if (!selectedNoteId) {
          setSelectedNoteId(String(firstPost.id));
        }
      } else {
        setSelectedNoteViewId(null);
        setSelectedNoteId("");
      }
    } catch (error) {
      showError(error);
    }
  }

  useEffect(() => {
    if (menu !== "posts") return;

    let isCurrent = true;
    void request<WikiTreeNode[]>("/posts/wiki/tree")
      .then((nodes) => {
        if (!isCurrent) return;
        setWikiTreeNodes(nodes);

        if (nodes.length > 0 && selectedWikiPath.length === 0) {
          const firstPath = nodes[0].path;
          setSelectedWikiPath(firstPath);
          setOpenedWikiPaths(getAncestorPathKeys(firstPath));
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) showError(error);
      });

    return () => {
      isCurrent = false;
    };
  }, [menu, selectedWikiPath.length]);

  useEffect(() => {
    if (menu !== "posts") return;

    const params = new URLSearchParams();
    params.set("page", String(wikiPage));
    params.set("limit", String(WIKI_PAGE_SIZE));

    for (const segment of selectedWikiPath) {
      params.append("path", segment);
    }

    if (keyword) {
      params.set("keyword", keyword);
    }
    if (tagFilter) {
      params.set("tag", tagFilter);
    }

    let isCurrent = true;
    void request<PostListResponse>(`/posts/wiki?${params.toString()}`)
      .then((data) => {
        if (!isCurrent) return;
        setWikiPosts(data.items);
        setWikiTotal(data.total);
        setWikiTotalPages(data.totalPages || 1);

        if (data.items.length > 0) {
          setSelectedWikiId((currentId) => {
            if (currentId && data.items.some((item) => item.id === currentId)) {
              return currentId;
            }

            return null;
          });
        } else {
          setSelectedWikiId(null);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) showError(error);
      });

    return () => {
      isCurrent = false;
    };
  }, [menu, keyword, tagFilter, selectedWikiPath, wikiPage]);

  useEffect(() => {
    if (menu !== "notes" && !isChatOpen) return;

    let isCurrent = true;
    void Promise.resolve(user)
      .then((currentUser) => {
        if (!currentUser) {
          if (isCurrent) setNotes([]);
          return null;
        }

        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", "100");

        if (keyword) {
          params.set("keyword", keyword);
        }
        if (departmentFilter) {
          params.set("department", departmentFilter);
        }
        if (tagFilter) {
          params.set("tag", tagFilter);
        }

        return request<PostListResponse>(`/posts/notes/my?${params.toString()}`);
      })
      .then((data) => {
        if (!isCurrent || !data) return;
        setNotes(data.items);

        if (data.items.length > 0) {
          const firstPost = data.items[0];
          const firstDepartment = getPostDepartment(firstPost);

          setSelectedNoteViewId((currentId) => {
            if (currentId && data.items.some((item) => item.id === currentId)) {
              return currentId;
            }

            return firstPost.id;
          });

          setOpenedNoteDepartments((departments) => {
            if (departments.includes(firstDepartment)) {
              return departments;
            }

            return [...departments, firstDepartment];
          });

          if (!selectedNoteId) {
            setSelectedNoteId(String(firstPost.id));
          }
        } else {
          setSelectedNoteViewId(null);
          setSelectedNoteId("");
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) showError(error);
      });

    return () => {
      isCurrent = false;
    };
  }, [
    departmentFilter,
    isChatOpen,
    keyword,
    menu,
    selectedNoteId,
    tagFilter,
    user,
  ]);

  useEffect(() => {
    if (IS_WORK_BRIEF_PREVIEW) return;
    let isCurrent = true;
    void request<User>("/auth/me")
      .then(async (me) => {
        await refreshCsrfToken();
        if (!isCurrent) return;
        setUser(me);
        setMenu((currentMenu) =>
          currentMenu === "login" ? "posts" : currentMenu,
        );
      })
      .catch(() => {
        if (!isCurrent) return;
        csrfToken = "";
        setUser(null);
        setNotes([]);
        setIsChatOpen(false);
        setMenu("login");
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (IS_WORK_BRIEF_PREVIEW) return;

    const url = new URL(window.location.href);
    const provider = url.searchParams.get("integration");
    const status = url.searchParams.get("integration_status");

    if (
      (provider !== "jira" && provider !== "confluence") ||
      (status !== "connected" &&
        status !== "provider_rejected" &&
        status !== "configuration_required" &&
        status !== "authorization_code_rejected" &&
        status !== "scope_configuration_required" &&
        status !== "oauth_request_rejected" &&
        status !== "provider_network_rejected" &&
        status !== "token_exchange_failed")
    ) {
      return;
    }

    // The OAuth callback query is external navigation state that is consumed
    // once, then removed from the address bar in this same effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenu("integrations");
    const message = integrationCallbackErrorMessage(provider, status);
    if (message) setMessage(message);

    url.searchParams.delete("integration");
    url.searchParams.delete("integration_status");
    window.history.replaceState({}, document.title, url);
  }, []);

  function startKeycloakLogin() {
    window.location.assign(`${API_BASE_URL}/auth/oidc/login`);
  }

  async function handleLogout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch {
      // An expired session is already unusable. Clear only client-side state.
    }

    clearClientSession();
    setMessage("로그아웃되었습니다.");
  }

  async function handlePostSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = JSON.stringify({
      title: postTitle,
      content: postContent,
      department: postDepartment,
      tags: splitTags(postTags),
    });

    try {
      if (editingPostId) {
        await request(`/posts/${editingPostId}`, {
          method: "PATCH",
          body,
        });
        setMessage("회사 위키 문서가 수정되었습니다.");
      } else {
        await request("/posts", {
          method: "POST",
          body,
        });
        setMessage("회사 위키 문서가 작성되었습니다.");
      }

      resetPostForm();
      await loadWikiPosts();
    } catch (error) {
      showError(error);
    }
  }

  async function handleNoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = JSON.stringify({
      title: noteTitle,
      content: noteContent,
      department: noteDepartment,
      tags: splitTags(noteTags),
    });

    try {
      if (editingNoteId) {
        const updatedNote = await request<BoardPost>(
          `/posts/${editingNoteId}`,
          {
            method: "PATCH",
            body,
          },
        );
        setSelectedNoteViewId(updatedNote.id);
        setMessage("내 노트가 수정되었습니다.");
      } else {
        const newNote = await request<BoardPost>("/posts/notes", {
          method: "POST",
          body,
        });
        setSelectedNoteViewId(newNote.id);
        setSelectedNoteId(String(newNote.id));
        setMessage("내 노트가 작성되었습니다.");
      }

      resetNoteForm();
      await loadNotes();
    } catch (error) {
      showError(error);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatQuestion.trim();

    if (!question) {
      setChatError("질문을 입력해주세요.");
      return;
    }

    try {
      setIsChatLoading(true);
      setChatError("");
      setChatSubmittedQuestion(question);
      setChatAnswer("");
      setChatSources([]);

      const data = await request<AiResponse>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          question,
        }),
      });

      setChatAnswer(data.answer);
      setChatSources(data.sources || []);

      if (!chatNoteTitle) {
        setChatNoteTitle(question.slice(0, 30) || "AI 정리 노트");
      }
    } catch (error) {
      if (error instanceof Error) {
        setChatError(error.message);
      } else {
        setChatError("오류가 발생했습니다.");
      }
      showError(error);
    } finally {
      setIsChatLoading(false);
    }
  }

  async function handleSaveChatAsNewNote() {
    if (!chatAnswer) {
      setMessage("저장할 AI 답변이 없습니다.");
      return;
    }

    try {
      const newNote = await request<BoardPost>("/posts/notes", {
        method: "POST",
        body: JSON.stringify({
          title: chatNoteTitle || "AI 정리 노트",
          content: makeAiNoteContent(""),
          department: user?.department || "공통",
          tags: ["AI", "챗봇"],
        }),
      });

      setSelectedNoteViewId(newNote.id);
      setSelectedNoteId(String(newNote.id));
      setMessage("AI 답변을 새 노트로 저장했습니다.");
      await loadNotes();
    } catch (error) {
      showError(error);
    }
  }

  async function handleAppendChatToNote() {
    if (!chatAnswer) {
      setMessage("추가할 AI 답변이 없습니다.");
      return;
    }

    const note = notes.find((item) => item.id === Number(selectedNoteId));

    if (!note) {
      setMessage("추가할 노트를 선택해주세요.");
      return;
    }

    try {
      await request(`/posts/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          content: makeAiNoteContent(note.content),
        }),
      });

      setSelectedNoteViewId(note.id);
      setMessage("AI 답변을 선택한 노트에 추가했습니다.");
      await loadNotes();
    } catch (error) {
      showError(error);
    }
  }

  function makeAiNoteContent(oldContent: string) {
    const nextContent = `[질문]\n${chatSubmittedQuestion || chatQuestion}\n\n[AI 정리]\n${chatAnswer}`;

    if (!oldContent) {
      return nextContent;
    }

    return `${oldContent}\n\n${nextContent}`;
  }

  function handleEditClick(post: BoardPost) {
    setEditingPostId(post.id);
    setPostTitle(post.title);
    setPostContent(post.content);
    setPostDepartment(post.department);
    setPostTags((post.tags || []).join(", "));
  }

  function handleNoteEditClick(post: BoardPost) {
    setSelectedNoteViewId(post.id);
    setEditingNoteId(post.id);
    setNoteTitle(post.title);
    setNoteContent(post.content);
    setNoteDepartment(post.department);
    setNoteTags((post.tags || []).join(", "));
  }

  async function handleDeleteClick(postId: number) {
    try {
      await request(`/posts/${postId}`, {
        method: "DELETE",
      });

      setMessage("삭제되었습니다.");
      await loadWikiPosts();
      setSelectedWikiDetail(null);
      await loadNotes();
    } catch (error) {
      showError(error);
    }
  }

  async function handleCommentSubmit(
    event: FormEvent<HTMLFormElement>,
    postId: number,
  ) {
    event.preventDefault();

    try {
      await request(`/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          content: commentText[postId] || "",
        }),
      });

      setCommentText({
        ...commentText,
        [postId]: "",
      });
      await loadWikiDetail(postId);
    } catch (error) {
      showError(error);
    }
  }

  async function handleCommentDelete(postId: number, commentId: number) {
    try {
      await request(`/posts/${postId}/comments/${commentId}`, {
        method: "DELETE",
      });

      await loadWikiDetail(postId);
    } catch (error) {
      showError(error);
    }
  }

  function resetPostForm() {
    setEditingPostId(null);
    setPostTitle("");
    setPostContent("");
    setPostDepartment("공통");
    setPostTags("");
  }

  function resetNoteForm() {
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteContent("");
    setNoteDepartment("공통");
    setNoteTags("");
  }

  function splitTags(value: string): string[] {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  function handleKeywordChange(event: ChangeEvent<HTMLInputElement>) {
    setKeyword(event.target.value);
    setWikiPage(1);
    setSelectedWikiId(null);
    setSelectedWikiDetail(null);
  }

  function handleDepartmentFilterChange(event: ChangeEvent<HTMLInputElement>) {
    setDepartmentFilter(event.target.value);
  }

  function handleTagFilterChange(event: ChangeEvent<HTMLInputElement>) {
    setTagFilter(event.target.value);
    setWikiPage(1);
    setSelectedWikiId(null);
    setSelectedWikiDetail(null);
  }

  function canManageWiki() {
    return user?.role === "admin";
  }

  function canEdit(post: BoardPost) {
    if (post.boardType === "wiki") {
      return canManageWiki();
    }

    return user && post.author && user.id === post.author.id;
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString();
  }

  function toggleWikiPath(path: string[]) {
    const pathKey = getPathKey(path);

    if (openedWikiPaths.includes(pathKey)) {
      setOpenedWikiPaths(openedWikiPaths.filter((item) => item !== pathKey));
      return;
    }

    setOpenedWikiPaths([...openedWikiPaths, pathKey]);
  }

  function selectWikiPath(path: string[]) {
    setSelectedWikiPath(path);
    setWikiPage(1);
    setSelectedWikiId(null);
    setSelectedWikiDetail(null);
    setOpenedWikiPaths((paths) => {
      const nextPaths = [...paths];

      for (const pathKey of getAncestorPathKeys(path)) {
        if (!nextPaths.includes(pathKey)) {
          nextPaths.push(pathKey);
        }
      }

      return nextPaths;
    });
  }

  function toggleNoteDepartment(department: string) {
    if (openedNoteDepartments.includes(department)) {
      setOpenedNoteDepartments(
        openedNoteDepartments.filter((item) => item !== department),
      );
      return;
    }

    setOpenedNoteDepartments([...openedNoteDepartments, department]);
  }

  function getDepartments(posts: BoardPost[]) {
    const departments: string[] = [];

    for (const post of posts) {
      const department = getPostDepartment(post);

      if (!departments.includes(department)) {
        departments.push(department);
      }
    }

    return departments;
  }

  function selectedWikiPost() {
    return (
      selectedWikiDetail ||
      wikiPosts.find((post) => post.id === selectedWikiId) ||
      null
    );
  }

  function selectedNotePost() {
    return notes.find((post) => post.id === selectedNoteViewId) || notes[0];
  }

  function buildWikiTree(nodes: WikiTreeNode[]): WikiTreeBranch[] {
    const branchMap = new Map<string, WikiTreeBranch>();
    const roots: WikiTreeBranch[] = [];

    for (const node of nodes) {
      branchMap.set(getPathKey(node.path), {
        ...node,
        children: [],
      });
    }

    for (const node of nodes) {
      const branch = branchMap.get(getPathKey(node.path));

      if (!branch) {
        continue;
      }

      if (node.path.length === 1) {
        roots.push(branch);
        continue;
      }

      const parent = branchMap.get(getPathKey(node.path.slice(0, -1)));
      parent?.children.push(branch);
    }

    return roots;
  }

  function renderWikiTree(branches: WikiTreeBranch[]) {
    return branches.map((branch) => {
      const pathKey = getPathKey(branch.path);
      const isOpen = openedWikiPaths.includes(pathKey);
      const isSelected = getPathKey(selectedWikiPath) === pathKey;
      const hasChildren = branch.children.length > 0;

      return (
        <div className="tree-group" key={pathKey}>
          <div
            className="tree-category-row"
            style={{ "--tree-depth": branch.depth } as CSSProperties}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="tree-toggle"
              onClick={() => toggleWikiPath(branch.path)}
            >
              {hasChildren ? (isOpen ? "▾" : "▸") : "•"}
            </Button>
            <button
              type="button"
              className={isSelected ? "tree-category active" : "tree-category"}
              onClick={() => selectWikiPath(branch.path)}
            >
              <span>{branch.name}</span>
              <small>{branch.documentCount}</small>
            </button>
          </div>

          {hasChildren && isOpen && renderWikiTree(branch.children)}
        </div>
      );
    });
  }

  function handleTagClick(tag: string) {
    setTagFilter(tag);
    setWikiPage(1);
    setSelectedWikiId(null);
    setSelectedWikiDetail(null);
  }

  function makeExcerpt(post: BoardPost) {
    const source = post.summary || post.content || "";
    const text = source
      .replace(/[#*_>`\-[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  }

  function getDepartmentSuggestions(posts: BoardPost[]) {
    const value = departmentFilter.trim().toLowerCase();

    if (!value) {
      return [];
    }

    return getDepartments(posts)
      .filter((department) => department.toLowerCase().includes(value))
      .filter((department) => department !== departmentFilter)
      .slice(0, 5);
  }

  function getTagSuggestions(posts: BoardPost[]) {
    const value = tagFilter.trim().toLowerCase();
    const tags: string[] = [];

    if (!value) {
      return [];
    }

    for (const post of posts) {
      for (const tag of post.tags || []) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }

    return tags
      .filter((tag) => tag.toLowerCase().includes(value))
      .filter((tag) => tag !== tagFilter)
      .slice(0, 5);
  }

  function openChatModal() {
    setIsChatOpen(true);
    setIsChatSignalVisible(false);

    if (user) {
      loadNotes();
    }
  }

  function toggleChatWidget() {
    if (isChatOpen) {
      setIsChatOpen(false);
      return;
    }

    openChatModal();
  }

  function closeChatModal() {
    setIsChatOpen(false);
  }

  function handleChatSuggestionClick(question: string) {
    setChatQuestion(question);
    setChatError("");
  }

  async function handleChatSourceClick(
    source: NonNullable<AiResponse["sources"]>[number],
  ) {
    if (!source.postId) {
      return;
    }

    setMenu("posts");
    setIsChatOpen(false);
    setIsChatSignalVisible(false);
    await loadWikiDetail(source.postId, { syncPath: true });
  }

  function renderSearchFilters(posts: BoardPost[]) {
    const departmentSuggestions = getDepartmentSuggestions(posts);
    const tagSuggestions = getTagSuggestions(posts);

    return (
      <div className="filters">
        <TextInput
          type="text"
          placeholder="제목/내용 검색"
          value={keyword}
          onChange={handleKeywordChange}
        />

        <div className="suggestion-field">
          <TextInput
            type="text"
            placeholder="부서"
            value={departmentFilter}
            onChange={handleDepartmentFilterChange}
          />
          {departmentSuggestions.length > 0 && (
            <div className="suggestion-list">
              {departmentSuggestions.map((department) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  key={department}
                  onClick={() => setDepartmentFilter(department)}
                >
                  {department}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="suggestion-field">
          <TextInput
            type="text"
            placeholder="태그"
            value={tagFilter}
            onChange={handleTagFilterChange}
          />
          {tagSuggestions.length > 0 && (
            <div className="suggestion-list">
              {tagSuggestions.map((tag) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  key={tag}
                  onClick={() => setTagFilter(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderWikiFilters() {
    const tagSuggestions = getTagSuggestions(wikiPosts);

    return (
      <div className="filters">
        <TextInput
          type="text"
          placeholder="제목/내용 검색"
          value={keyword}
          onChange={handleKeywordChange}
        />

        <div className="suggestion-field">
          <TextInput
            type="text"
            placeholder="태그"
            value={tagFilter}
            onChange={handleTagFilterChange}
          />
          {tagSuggestions.length > 0 && (
            <div className="suggestion-list">
              {tagSuggestions.map((tag) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  key={tag}
                  onClick={() => handleTagClick(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderMarkdown(content: string, className: string) {
    return (
      <div className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <>
      <Header
        title="Work Copilot"
        menu={menu}
        user={user}
        onMenuClick={setMenu}
        onLogout={handleLogout}
      />

      <main className={menu === "workBriefs" ? "app-main--workspace" : undefined}>
        {message && (
          <Alert tone="warning" className="app-message">
            {message}
          </Alert>
        )}

        {menu === "login" && (
          <section className="auth-layout" aria-labelledby="login-title">
            <Card className="auth-card">
              <p className="auth-eyebrow">회사 계정 인증</p>
              <h2 id="login-title">회사 계정 로그인</h2>
              <p className="auth-subtitle">
                Keycloak 회사 계정으로만 로그인할 수 있습니다.
              </p>
              <Button type="button" onClick={startKeycloakLogin}>
                회사 계정으로 계속
              </Button>
              <p className="auth-security-note">
                인증은 회사 계정 페이지에서 안전하게 진행됩니다.
              </p>
            </Card>
          </section>
        )}

        {menu === "posts" && (
          <section className="wiki-layout wiki-layout--company">
            <aside className="wiki-sidebar ds-card">
              <h2>분류</h2>
              {renderWikiFilters()}

              <div className="tree">
                {renderWikiTree(buildWikiTree(wikiTreeNodes))}
              </div>
            </aside>

            <section className="wiki-main">
              {canManageWiki() && (
                <section className="panel ds-card">
                  <h2>{editingPostId ? "회사 위키 수정" : "회사 위키 작성"}</h2>
                  <form onSubmit={handlePostSubmit}>
                    <label htmlFor="post-title">제목</label>
                    <TextInput
                      id="post-title"
                      type="text"
                      value={postTitle}
                      onChange={(event) => setPostTitle(event.target.value)}
                    />

                    <label htmlFor="post-department">부서</label>
                    <TextInput
                      id="post-department"
                      type="text"
                      value={postDepartment}
                      onChange={(event) =>
                        setPostDepartment(event.target.value)
                      }
                    />

                    <label htmlFor="post-tags">태그</label>
                    <TextInput
                      id="post-tags"
                      type="text"
                      placeholder="급여, 온보딩, 개발"
                      value={postTags}
                      onChange={(event) => setPostTags(event.target.value)}
                    />

                    <label htmlFor="post-content">내용</label>
                    <TextArea
                      id="post-content"
                      value={postContent}
                      onChange={(event) => setPostContent(event.target.value)}
                    />

                    <div className="button-row">
                      <Button type="submit">
                        {editingPostId ? "수정하기" : "작성하기"}
                      </Button>
                      {editingPostId && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={resetPostForm}
                        >
                          취소
                        </Button>
                      )}
                    </div>
                  </form>
                </section>
              )}

              <section className="wiki-card-list">
                <div className="wiki-card-list-head">
                  <div>
                    <h2>
                      {selectedWikiPath.length > 0
                        ? selectedWikiPath.join(" / ")
                        : "문서"}
                    </h2>
                    <p>
                      총 {wikiTotal}개 문서 · {wikiPage}/{wikiTotalPages} 페이지
                    </p>
                  </div>

                  {tagFilter && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setTagFilter("");
                        setWikiPage(1);
                      }}
                    >
                      태그 필터 해제: {tagFilter}
                    </Button>
                  )}
                </div>

                {wikiPosts.length > 0 ? (
                  wikiPosts.map((post) => (
                    <article
                      key={post.id}
                      className={
                        selectedWikiId === post.id
                          ? "wiki-card ds-card active"
                          : "wiki-card ds-card"
                      }
                    >
                      <button
                        type="button"
                        className="wiki-card-open"
                        onClick={() => loadWikiDetail(post.id)}
                      >
                        <div className="wiki-card-title-row">
                          <h3>{post.title}</h3>
                          {post.docType && <Badge tone="info">{post.docType}</Badge>}
                        </div>
                        <p>{makeExcerpt(post)}</p>
                        <small>
                          {post.author?.nickname || "작성자 없음"} ·{" "}
                          {formatDate(post.createdAt)}
                        </small>
                      </button>

                      <div className="wiki-card-tags">
                        {(post.tags || []).slice(0, 5).map((tag) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            key={tag}
                            onClick={() => handleTagClick(tag)}
                          >
                            {tag}
                          </Button>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <section className="panel ds-card wiki-empty-state" role="status">
                    <h2>문서가 없습니다.</h2>
                    <p>다른 분류를 선택하거나 검색 조건을 변경해주세요.</p>
                  </section>
                )}

                <div className="pagination">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={wikiPage <= 1}
                    onClick={() => setWikiPage((page) => Math.max(1, page - 1))}
                  >
                    이전
                  </Button>
                  <span>
                    {wikiPage} / {wikiTotalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={wikiPage >= wikiTotalPages}
                    onClick={() =>
                      setWikiPage((page) => Math.min(wikiTotalPages, page + 1))
                    }
                  >
                    다음
                  </Button>
                </div>
              </section>

              {selectedWikiPost() && (
                <article className="document ds-card">
                  <div className="post-head">
                    <div>
                      <h2>{selectedWikiPost()?.title}</h2>
                      <p>
                        {selectedWikiPost()?.wikiPath?.join(" / ") ||
                          selectedWikiPost()?.department}{" "}
                        · {selectedWikiPost()?.author?.nickname} ·{" "}
                        {formatDate(selectedWikiPost()?.createdAt || "")}
                      </p>
                    </div>

                    {selectedWikiPost() && canEdit(selectedWikiPost()!) && (
                      <div className="button-row">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEditClick(selectedWikiPost()!)}
                        >
                          수정
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            handleDeleteClick(selectedWikiPost()!.id)
                          }
                        >
                          삭제
                        </Button>
                      </div>
                    )}
                  </div>

                  {renderMarkdown(
                    selectedWikiPost()?.content || "",
                    "post-content markdown-content",
                  )}

                  <div className="tags">
                    {(selectedWikiPost()?.tags || []).map((tag) => (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        key={tag}
                        onClick={() => handleTagClick(tag)}
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>

                  {selectedWikiPost() && (
                    <div className="comments">
                      <h4>댓글</h4>
                      {(selectedWikiPost()?.comments || []).map((comment) => (
                        <div className="comment" key={comment.id}>
                          <p>{comment.content}</p>
                          <small>
                            {comment.isAi
                              ? "AI 답변"
                              : comment.author?.nickname}{" "}
                            · {formatDate(comment.createdAt)}
                          </small>
                          {(user?.id === comment.author?.id ||
                            canManageWiki()) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="comment-delete"
                              onClick={() =>
                                handleCommentDelete(
                                  selectedWikiPost()!.id,
                                  comment.id,
                                )
                              }
                            >
                              삭제
                            </Button>
                          )}
                        </div>
                      ))}

                      {user && (
                        <form
                          className="comment-form"
                          onSubmit={(event) =>
                            handleCommentSubmit(event, selectedWikiPost()!.id)
                          }
                        >
                          <TextInput
                            type="text"
                            placeholder="댓글 입력"
                            value={commentText[selectedWikiPost()!.id] || ""}
                            onChange={(event) =>
                              setCommentText({
                                ...commentText,
                                [selectedWikiPost()!.id]: event.target.value,
                              })
                            }
                          />
                          <Button type="submit">등록</Button>
                        </form>
                      )}
                    </div>
                  )}
                </article>
              )}
            </section>
          </section>
        )}

        {menu === "admin" && user?.role === "admin" && (
          <IntegrationProfilesPage request={request} />
        )}

        {menu === "workBriefs" && user && (
          <WorkBriefsPage
            request={IS_WORK_BRIEF_PREVIEW ? previewWorkBriefRequest : request}
            onOpenIntegrations={() => setMenu("integrations")}
            initialIssueKey={IS_WORK_BRIEF_PREVIEW ? WORK_BRIEF_PREVIEW_ISSUE : undefined}
            initialEvidence={IS_WORK_BRIEF_PREVIEW ? WORK_BRIEF_PREVIEW_EVIDENCE : undefined}
          />
        )}

        {menu === "integrations" && user && (
          <IntegrationConnectionsPage request={request} />
        )}

        {menu === "notes" && (
          <section className="wiki-layout wiki-layout--notes" aria-labelledby="notes-title">
            <aside className="wiki-sidebar ds-card">
              <h2 id="notes-title">내 노트</h2>
              {!user && (
                <Alert tone="info" className="notes-login-hint">
                  로그인하면 내 노트를 볼 수 있습니다.
                </Alert>
              )}

              {user && (
                <>
                  {renderSearchFilters(notes)}

                  <div className="tree">
                    {getDepartments(notes).map((department) => (
                      <div className="tree-group" key={department}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="tree-department"
                          onClick={() => toggleNoteDepartment(department)}
                        >
                          {openedNoteDepartments.includes(department)
                            ? "▾"
                            : "▸"}{" "}
                          {department}
                        </Button>

                        {openedNoteDepartments.includes(department) &&
                          notes
                            .filter(
                              (note) => getPostDepartment(note) === department,
                            )
                            .map((note) => (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={
                                  selectedNotePost()?.id === note.id
                                    ? "tree-post active"
                                    : "tree-post"
                                }
                                key={note.id}
                                onClick={() => setSelectedNoteViewId(note.id)}
                              >
                                {note.title}
                              </Button>
                            ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>

            <section className="wiki-main">
              <section className="panel ds-card">
                <h2>{editingNoteId ? "내 노트 수정" : "내 노트 작성"}</h2>
                {!user && (
                  <Alert tone="info" className="notes-login-hint">
                    로그인하면 내 노트를 작성할 수 있습니다.
                  </Alert>
                )}

                {user && (
                  <form onSubmit={handleNoteSubmit}>
                    <label htmlFor="note-title">제목</label>
                    <TextInput
                      id="note-title"
                      type="text"
                      value={noteTitle}
                      onChange={(event) => setNoteTitle(event.target.value)}
                    />

                    <label htmlFor="note-department">관련 부서</label>
                    <TextInput
                      id="note-department"
                      type="text"
                      value={noteDepartment}
                      onChange={(event) =>
                        setNoteDepartment(event.target.value)
                      }
                    />

                    <label htmlFor="note-tags">태그</label>
                    <TextInput
                      id="note-tags"
                      type="text"
                      placeholder="급여, 온보딩, 휴가"
                      value={noteTags}
                      onChange={(event) => setNoteTags(event.target.value)}
                    />

                    <label htmlFor="note-content">내용</label>
                    <TextArea
                      id="note-content"
                      value={noteContent}
                      onChange={(event) => setNoteContent(event.target.value)}
                    />

                    <div className="button-row">
                      <Button type="submit">
                        {editingNoteId ? "수정하기" : "작성하기"}
                      </Button>
                      {editingNoteId && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={resetNoteForm}
                        >
                          취소
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </section>

              {user && selectedNotePost() ? (
                <article className="document ds-card">
                  <div className="post-head">
                    <div>
                      <h2>{selectedNotePost()?.title}</h2>
                      <p>
                        {selectedNotePost()?.department} ·{" "}
                        {formatDate(selectedNotePost()?.createdAt || "")}
                      </p>
                    </div>

                    <div className="button-row">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleNoteEditClick(selectedNotePost()!)}
                      >
                        수정
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() =>
                          handleDeleteClick(selectedNotePost()!.id)
                        }
                      >
                        삭제
                      </Button>
                    </div>
                  </div>

                  <p className="post-content">{selectedNotePost()?.content}</p>

                  <div className="tags">
                    {(selectedNotePost()?.tags || []).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </article>
              ) : (
                <section className="panel ds-card notes-empty-state" role="status">
                  <h2>아직 저장한 노트가 없습니다.</h2>
                  <p>
                    AI 챗봇 답변을 저장하거나 직접 노트를 작성하면 여기에
                    표시됩니다.
                  </p>
                </section>
              )}
            </section>
          </section>
        )}
      </main>

      {user && !IS_WORK_BRIEF_PREVIEW && (
        <div className="chat-widget-area">
          {isChatOpen && (
            <section className="chat-widget ds-card" id="ai-chatbot" aria-labelledby="ai-chatbot-title">
              <div className="chat-widget-head">
                <div>
                  <h2 id="ai-chatbot-title">AI 챗봇</h2>
                  <p>회사 위키 기반 답변</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="chat-close-button"
                  onClick={closeChatModal}
                >
                  닫기
                </Button>
              </div>

              <div className="chat-greeting">
                <div className="chat-avatar">AI</div>
                <p>
                  회사 위키를 기준으로 답변하고, 필요한 답변은 내 노트에 저장할
                  수 있어요.
                </p>
              </div>

              {user && (
                <div className="chat-suggestions">
                  {CHAT_SUGGESTIONS.map((question) => (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="chat-suggestion"
                      key={question}
                      onClick={() => handleChatSuggestionClick(question)}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              )}

              <div className="chat-messages" aria-live="polite">
                {!user && (
                  <div className="chat-bubble ai-bubble">
                    로그인하면 회사 위키를 바탕으로 질문할 수 있습니다.
                  </div>
                )}

                {user &&
                  !chatSubmittedQuestion &&
                  !chatAnswer &&
                  !isChatLoading && (
                    <div className="chat-bubble ai-bubble">
                      궁금한 내용을 입력하거나 추천 질문을 선택해주세요.
                    </div>
                  )}

                {chatSubmittedQuestion && (
                  <div className="chat-bubble user-bubble">
                    {chatSubmittedQuestion}
                  </div>
                )}

                {isChatLoading && (
                  <div className="chat-bubble ai-bubble">
                    답변을 찾고 있습니다.
                  </div>
                )}

                {chatError && (
                  <Alert tone="danger" className="chat-bubble error-bubble">
                    {chatError}
                  </Alert>
                )}

                {chatAnswer && (
                  <div className="chat-bubble ai-bubble">
                    {renderMarkdown(
                      chatAnswer,
                      "markdown-content chat-markdown",
                    )}
                  </div>
                )}

                {chatSources && chatSources.length > 0 && (
                  <div className="chat-sources">
                    <strong>참고 문서</strong>
                    {chatSources.map((source) => (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="chat-source"
                        key={source.sourceId}
                        disabled={!source.postId}
                        onClick={() => handleChatSourceClick(source)}
                      >
                        <span>{source.title}</span>
                        <small>{source.department}</small>
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {user && (
                <form className="chat-input-form" onSubmit={handleChatSubmit}>
                  <div className="chat-input-row">
                    <TextArea
                      id="chat-question"
                      aria-label="AI 챗봇 질문"
                      placeholder="메시지를 입력하세요"
                      value={chatQuestion}
                      onChange={(event) => setChatQuestion(event.target.value)}
                    />
                    <Button type="submit" disabled={isChatLoading}>
                      전송
                    </Button>
                  </div>
                </form>
              )}

              {user && chatAnswer && (
                <div className="chat-note-save">
                  <label htmlFor="chat-note-title">새 노트 제목</label>
                  <TextInput
                    id="chat-note-title"
                    type="text"
                    value={chatNoteTitle}
                    onChange={(event) => setChatNoteTitle(event.target.value)}
                  />

                  <div className="chat-note-actions">
                    <Button type="button" onClick={handleSaveChatAsNewNote}>
                      새 노트로 저장
                    </Button>
                  </div>

                  <label htmlFor="target-note">기존 노트 선택</label>
                  <Select
                    id="target-note"
                    value={selectedNoteId}
                    onChange={(event) => setSelectedNoteId(event.target.value)}
                  >
                    <option value="">노트 선택</option>
                    {notes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title}
                      </option>
                    ))}
                  </Select>

                  <div className="chat-note-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAppendChatToNote}
                    >
                      기존 노트에 추가
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {isChatSignalVisible && !isChatOpen && (
            <div className="chat-signal ds-card" role="status">
              <span>궁금한 점은 AI에게 물어보세요.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="chat-signal-close"
                onClick={() => setIsChatSignalVisible(false)}
              >
                닫기
              </Button>
            </div>
          )}

          <Button
            type="button"
            className={
              isChatOpen
                ? "chat-floating-button active"
                : "chat-floating-button"
            }
            onClick={toggleChatWidget}
            aria-controls="ai-chatbot"
            aria-expanded={isChatOpen}
          >
            AI
          </Button>
        </div>
      )}
    </>
  );
}

export default App;
