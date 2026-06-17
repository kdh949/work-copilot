import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiUrl } from "./api";

function authJsonFetch(url: string, options: RequestInit = {}) {
  const accessToken = localStorage.getItem("accessToken");

  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

type Board = {
  id: number;
  title: string;
  content: string;
  tag?: string;
  tags: string[];
  writer: string;
  viewCount: number;
};

type Comment = {
  id: number;
  boardId: number;
  content: string;
  writer: string;
};

type PopularTag = {
  name: string;
  count: number;
};

type RecentComment = Comment & {
  boardTitle: string;
};

type AiReference = {
  title?: string;
  sourceUrl?: string;
  repositoryUrl?: string;
  chunkText?: string;
  content?: string;
  snippet?: string;
  summary?: string;
  type?: string;
  category?: string;
  score?: number;
};

type AiAnswer = {
  question: string;
  answer: string;
  agentRoute: string;
  usedTools: string[];
  references: AiReference[];
};

type BoardPageProps = {
  loginId: string;
  onLogout?: () => void;
};

type View = "board" | "ai" | "knowledge" | "activity" | "write" | "edit" | "detail";
type KnowledgeId = "blog" | "official" | "board" | "comment";
type CardIconName = KnowledgeId | "faq" | "github" | "posts" | "comments" | "ai" | "saved";
type KnowledgeSummary = {
  blogCount: number;
  officialCount: number;
  chunkCount: number;
  boardCount: number;
  commentCount: number;
};
type KnowledgeResource = {
  id: string;
  title: string;
  source: string;
  summary: string;
  status: string;
};
type StatCardData = {
  icon: CardIconName;
  label: string;
  value: number;
  hint: string;
};

function CardIconBadge({ name, label }: { name: CardIconName; label: string }) {
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

  const icons: Record<CardIconName, React.ReactElement> = {
    faq: (
      <svg {...commonProps}>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        <path d="M10 9a2 2 0 1 1 3.2 1.6c-.7.5-1.2.9-1.2 1.9" />
        <path d="M12 16h.01" />
      </svg>
    ),
    blog: (
      <svg {...commonProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
        <path d="M8.5 10h5" />
        <path d="M8.5 13h3" />
      </svg>
    ),
    github: (
      <svg {...commonProps}>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M6 8v2a4 4 0 0 0 4 4h2" />
        <path d="M18 8v2a4 4 0 0 1-4 4h-2" />
        <path d="M12 14v2" />
      </svg>
    ),
    official: (
      <svg {...commonProps}>
        <path d="M4 20h16" />
        <path d="M6 20V9l6-5 6 5v11" />
        <path d="M9 20v-6h6v6" />
        <path d="M9 10h.01" />
        <path d="M15 10h.01" />
      </svg>
    ),
    board: (
      <svg {...commonProps}>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    ),
    comment: (
      <svg {...commonProps}>
        <path d="M21 14a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    ),
    posts: (
      <svg {...commonProps}>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h5" />
        <path d="M10 13h6" />
        <path d="M10 17h4" />
      </svg>
    ),
    comments: (
      <svg {...commonProps}>
        <path d="M21 14a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
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
    saved: (
      <svg {...commonProps}>
        <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z" />
        <path d="m9.5 11.5 1.7 1.7 3.8-4" />
      </svg>
    ),
  };

  return <span className="card-icon">{icons[name]}</span>;
}

const VIEW_PATHS: Record<Exclude<View, "edit" | "detail">, string> = {
  board: "/board",
  ai: "/ai",
  knowledge: "/knowledge",
  activity: "/activity",
  write: "/board/new",
};

function getViewFromPath(pathname: string): View {
  if (pathname === "/" || pathname === "/board") {
    return "board";
  }

  if (pathname === "/ai") {
    return "ai";
  }

  if (pathname === "/knowledge") {
    return "knowledge";
  }

  if (pathname === "/activity") {
    return "activity";
  }

  if (pathname === "/board/new") {
    return "write";
  }

  if (/^\/board\/\d+\/edit$/.test(pathname)) {
    return "edit";
  }

  if (/^\/board\/\d+$/.test(pathname)) {
    return "detail";
  }

  return "board";
}

function getBoardIdFromPath(pathname: string) {
  const match = pathname.match(/^\/board\/(\d+)(?:\/edit)?$/);
  return match ? Number(match[1]) : null;
}

const DEFAULT_TAG_OPTIONS = ["알고리즘", "프로젝트", "GitHub", "백엔드", "NestJS", "React"];
const KNOWLEDGE_CARDS: Array<{
  id: KnowledgeId;
  icon: KnowledgeId;
  title: string;
  description: string;
  countKey: keyof KnowledgeSummary;
  countLabel: string;
}> = [
  {
    id: "blog",
    icon: "blog",
    title: "블로그 검색",
    description: "정글 후기와 외부 블로그 RAG 문서",
    countKey: "blogCount",
    countLabel: "문서",
  },
  {
    id: "official",
    icon: "official",
    title: "공식 자료",
    description: "크래프톤 정글 공식/전시 자료",
    countKey: "officialCount",
    countLabel: "문서",
  },
  {
    id: "board",
    icon: "board",
    title: "게시판 근거",
    description: "사용자가 작성한 게시판 글",
    countKey: "boardCount",
    countLabel: "게시글",
  },
  {
    id: "comment",
    icon: "comment",
    title: "댓글 근거",
    description: "게시판 댓글 데이터",
    countKey: "commentCount",
    countLabel: "댓글",
  },
];

function formatDateFromId(id: number) {
  const day = Math.max(1, 18 - (id % 9));
  return `2026.06.${String(day).padStart(2, "0")}`;
}

function getBoardTags(board: Board) {
  return board.tags?.length ? board.tags : board.tag ? [board.tag] : [];
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

function MarkdownAnswer({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const listItems: string[] = [];

  function flushList() {
    if (!listItems.length) {
      return;
    }

    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    listItems.length = 0;
  }

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.slice(3))}</h3>);
      return;
    }

    if (line.startsWith("### ")) {
      flushList();
      blocks.push(<h4 key={`h4-${index}`}>{renderInlineMarkdown(line.slice(4))}</h4>);
      return;
    }

    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();
    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(line)}</p>);
  });

  flushList();
  return <div className="ai-answer-markdown">{blocks}</div>;
}

export const BoardPage = ({ loginId, onLogout }: BoardPageProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const view = getViewFromPath(location.pathname);
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [tagOptions, setTagOptions] = React.useState(DEFAULT_TAG_OPTIONS);
  const [message, setMessage] = React.useState("");
  const [editingBoardId, setEditingBoardId] = React.useState<number | null>(null);
  const [selectedBoard, setSelectedBoard] = React.useState<Board | null>(null);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [popularTags, setPopularTags] = React.useState<PopularTag[]>([]);
  const [recentComments, setRecentComments] = React.useState<RecentComment[]>([]);
  const [commentContent, setCommentContent] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [searchKeyword, setSearchKeyword] = React.useState("");
  const [activeTag, setActiveTag] = React.useState("전체");
  const [deleteTarget, setDeleteTarget] = React.useState<Board | null>(null);
  const [aiQuestion, setAiQuestion] = React.useState("");
  const [aiAnswer, setAiAnswer] = React.useState<AiAnswer | null>(null);
  const [aiError, setAiError] = React.useState("");
  const [isAiLoading, setIsAiLoading] = React.useState(false);
  const [knowledgePreview, setKnowledgePreview] = React.useState<KnowledgeId>("official");
  const [knowledgeSummary, setKnowledgeSummary] = React.useState<KnowledgeSummary>({
    blogCount: 0,
    officialCount: 0,
    chunkCount: 0,
    boardCount: 0,
    commentCount: 0,
  });
  const [knowledgeResources, setKnowledgeResources] = React.useState<KnowledgeResource[]>([]);
  const [knowledgeError, setKnowledgeError] = React.useState("");
  const [isKnowledgeLoading, setIsKnowledgeLoading] = React.useState(false);
  const [showAllKnowledgeResources, setShowAllKnowledgeResources] = React.useState(false);

  const limit = 10;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const isBoardFormDisabled = title === "" || content === "" || selectedTags.length === 0;
  const myBoards = boards.filter((board) => board.writer === loginId);
  const visibleBoards =
    activeTag === "전체"
      ? boards
      : boards.filter((board) => getBoardTags(board).includes(activeTag));
  const selectedKnowledgeCard =
    KNOWLEDGE_CARDS.find((card) => card.id === knowledgePreview) ?? KNOWLEDGE_CARDS[0];
  const selectedKnowledgeCount = knowledgeSummary[selectedKnowledgeCard.countKey];
  const visibleKnowledgeResources = showAllKnowledgeResources
    ? knowledgeResources
    : knowledgeResources.slice(0, 5);
  const fetchBoards = React.useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      keyword: searchKeyword,
    });
    const response = await fetch(apiUrl(`/boards?${params}`));
    const data = await response.json();

    setBoards(data.items ?? []);
    setTotal(data.total ?? 0);
  }, [page, searchKeyword]);

  const fetchTagOptions = React.useCallback(async () => {
    const response = await fetch(apiUrl("/boards/tags"));

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    setTagOptions([...new Set([...DEFAULT_TAG_OPTIONS, ...data])]);
  }, []);

  React.useEffect(() => {
    void Promise.resolve().then(fetchBoards);
  }, [fetchBoards]);

  React.useEffect(() => {
    void Promise.resolve().then(fetchTagOptions);
  }, [fetchTagOptions]);

  React.useEffect(() => {
    void Promise.resolve().then(async () => {
      const [popularTagsResponse, recentCommentsResponse] = await Promise.all([
        fetch(apiUrl("/boards/tags/popular")),
        fetch(apiUrl("/comments/recent")),
      ]);

      if (popularTagsResponse.ok) {
        setPopularTags(await popularTagsResponse.json());
      }

      if (recentCommentsResponse.ok) {
        setRecentComments(await recentCommentsResponse.json());
      }
    });
  }, []);

  React.useEffect(() => {
    void Promise.resolve().then(async () => {
      const response = await fetch(apiUrl("/ai/knowledge/summary"));

      if (!response.ok) {
        setKnowledgeError("지식베이스 요약을 불러오지 못했습니다.");
        return;
      }

      const data = await response.json();
      setKnowledgeSummary(data);
    });
  }, []);

  React.useEffect(() => {
    void Promise.resolve().then(async () => {
      setIsKnowledgeLoading(true);
      setKnowledgeError("");
      setShowAllKnowledgeResources(false);

      try {
        const response = await fetch(apiUrl(`/ai/knowledge/resources?kind=${knowledgePreview}`));

        if (!response.ok) {
          setKnowledgeError("지식베이스 자료를 불러오지 못했습니다.");
          return;
        }

        const data = await response.json();
        setKnowledgeResources(data);
      } finally {
        setIsKnowledgeLoading(false);
      }
    });
  }, [knowledgePreview]);

  React.useEffect(() => {
    if (location.pathname === "/") {
      navigate("/board", { replace: true });
    }
  }, [location.pathname, navigate]);

  React.useEffect(() => {
    const boardId = getBoardIdFromPath(location.pathname);

    if (boardId === null) {
      return;
    }

    void Promise.resolve().then(async () => {
      const response = await fetch(apiUrl(`/boards/${boardId}`));

      if (!response.ok) {
        setMessage("게시글 조회 실패");
        return;
      }

      const data = await response.json();
      setSelectedBoard(data);
      fetchComments(data.id);

      if (location.pathname.endsWith("/edit")) {
        setEditingBoardId(data.id);
        setTitle(data.title);
        setContent(data.content);
        setSelectedTags(getBoardTags(data));
      }
    });
  }, [location.pathname]);

  function goToBoard() {
    navigate("/board");
    setSelectedBoard(null);
    setDeleteTarget(null);
    setCommentContent("");
    resetForm();
  }

  function goToTab(nextView: View) {
    if (nextView === "edit" || nextView === "detail") {
      return;
    }

    navigate(VIEW_PATHS[nextView]);
    setSelectedBoard(null);
    setDeleteTarget(null);
    setMessage("");
    resetForm();
  }

  function resetForm() {
    setEditingBoardId(null);
    setTitle("");
    setContent("");
    setSelectedTags([]);
    setTagDraft("");
  }

  function addTag(tagName: string) {
    const nextTag = tagName.trim();

    if (!nextTag) {
      return;
    }

    setSelectedTags((current) =>
      current.includes(nextTag) ? current : [...current, nextTag],
    );
    setTagOptions((current) =>
      current.includes(nextTag) ? current : [...current, nextTag],
    );
    setTagDraft("");
  }

  function removeTag(tagName: string) {
    setSelectedTags((current) => current.filter((tag) => tag !== tagName));
  }

  function toggleTag(tagName: string) {
    if (selectedTags.includes(tagName)) {
      removeTag(tagName);
    } else {
      addTag(tagName);
    }
  }

  async function fetchComments(boardId: number) {
    const response = await fetch(apiUrl(`/comments?boardId=${boardId}`));

    if (!response.ok) {
      setMessage("댓글 조회 실패");
      return;
    }

    const data = await response.json();
    setComments(data);
  }

  async function handleSelectBoard(id: number) {
    const response = await fetch(apiUrl(`/boards/${id}`));

    if (!response.ok) {
      setMessage("게시글 조회 실패");
      return;
    }

    const data = await response.json();
    setSelectedBoard(data);
    fetchComments(data.id);
    fetchBoards();
    navigate(`/board/${data.id}`);
    setMessage("");
  }

  async function handleCreateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await authJsonFetch(apiUrl("/boards"), {
      method: "POST",
      body: JSON.stringify({
        title,
        content,
        tags: selectedTags,
        writer: loginId,
      }),
    });

    if (!response.ok) {
      setMessage("게시글 작성 실패");
      return;
    }

    const newBoard = await response.json();
    resetForm();
    setMessage("게시글 작성 완료");
    setSelectedBoard(newBoard);
    fetchComments(newBoard.id);
    navigate(`/board/${newBoard.id}`);
    fetchBoards();
  }

  function startEdit(board: Board) {
    setEditingBoardId(board.id);
    setTitle(board.title);
    setContent(board.content);
    setSelectedTags(getBoardTags(board));
    navigate(`/board/${board.id}/edit`);
    setMessage("");
  }

  async function handleUpdateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (editingBoardId === null) {
      return;
    }

    const response = await authJsonFetch(apiUrl(`/boards/${editingBoardId}`), {
      method: "PATCH",
      body: JSON.stringify({ title, content, tags: selectedTags }),
    });

    if (!response.ok) {
      setMessage("게시글 수정 실패");
      return;
    }

    resetForm();
    setMessage("게시글 수정 완료");
    navigate(`/board/${editingBoardId}`);
    handleSelectBoard(editingBoardId);
    fetchBoards();
  }

  async function handleDeleteBoard() {
    if (!deleteTarget) {
      return;
    }

    const response = await authJsonFetch(apiUrl(`/boards/${deleteTarget.id}`), {
      method: "DELETE",
    });

    if (!response.ok) {
      setMessage("게시글 삭제 실패");
      return;
    }

    setMessage("게시글 삭제 완료");
    goToBoard();
    fetchBoards();
  }

  async function handleCreateComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedBoard) {
      return;
    }

    const response = await authJsonFetch(apiUrl("/comments"), {
      method: "POST",
      body: JSON.stringify({
        boardId: selectedBoard.id,
        content: commentContent,
        writer: loginId,
      }),
    });

    if (!response.ok) {
      setMessage("댓글 작성 실패");
      return;
    }

    setCommentContent("");
    fetchComments(selectedBoard.id);
  }

  async function handleDeleteComment(id: number) {
    const response = await authJsonFetch(apiUrl(`/comments/${id}`), {
      method: "DELETE",
    });

    if (!response.ok) {
      setMessage("댓글 삭제 실패");
      return;
    }

    if (selectedBoard) {
      fetchComments(selectedBoard.id);
    }
  }

  async function handleAskAi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = aiQuestion.trim();

    if (!question) {
      return;
    }

    setIsAiLoading(true);
    setAiError("");

    try {
      const response = await authJsonFetch(apiUrl("/ai/ask"), {
        method: "POST",
        body: JSON.stringify({
          question,
          limit: 5,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message ?? "AI 질문에 실패했습니다.");
      }

      setAiAnswer({
        question: data.question ?? question,
        answer: data.answer ?? "",
        agentRoute: data.agentRoute ?? "UNKNOWN",
        usedTools: Array.isArray(data.usedTools) ? data.usedTools : [],
        references: Array.isArray(data.references) ? data.references : [],
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 질문에 실패했습니다.");
    } finally {
      setIsAiLoading(false);
    }
  }

  function renderNavButton(label: string, target: View) {
    const isActive =
      view === target ||
      (target === "board" && ["write", "edit", "detail"].includes(view));

    return (
      <button
        className={`app-nav-button ${isActive ? "is-active" : ""}`}
        type="button"
        onClick={() => goToTab(target)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand-lockup" type="button" onClick={goToBoard}>
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <strong>정글 AI 멘토</strong>
        </button>

        <nav className="app-nav" aria-label="주요 메뉴">
          {renderNavButton("게시판", "board")}
          {renderNavButton("AI 질문", "ai")}
          {renderNavButton("지식베이스", "knowledge")}
          {renderNavButton("내 활동", "activity")}
        </nav>

        <div className="app-user">
          <button className="user-name-button" type="button" onClick={onLogout}>
            {loginId}님
          </button>
        </div>
      </header>

      <main className="workspace">
        {message && <p className="board-message">{message}</p>}

        {view === "board" && (
          <section className="screen board-screen">
            <div className="screen-heading">
              <div>
                <h1>게시판</h1>
                <p>정글 학습과 프로젝트, 궁금한 내용을 자유롭게 나눠보세요.</p>
              </div>
              <button className="primary-action" type="button" onClick={() => navigate("/board/new")}>
                글쓰기
              </button>
            </div>

            <div className="board-grid">
              <div className="board-main">
                <form
                  className="search-field"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPage(1);
                    setSearchKeyword(keyword);
                  }}
                >
                  <input
                    type="text"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="제목, 내용, 작성자를 검색하세요"
                  />
                  <button type="submit" aria-label="검색">
                    search
                  </button>
                </form>

                <div className="filter-row">
                  {["전체", "질문", "학습", "알고리즘", "프로젝트", "GitHub", "자료공유", "기타"].map(
                    (tag) => (
                      <button
                        className={activeTag === tag ? "is-active" : ""}
                        type="button"
                        key={tag}
                        onClick={() => setActiveTag(tag)}
                      >
                        {tag}
                      </button>
                    ),
                  )}
                </div>

                <div className="table-card">
                  <table className="board-table">
                    <thead>
                      <tr>
                        <th>번호</th>
                        <th>제목</th>
                        <th>작성자</th>
                        <th>태그</th>
                        <th>조회수</th>
                        <th>작성일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleBoards.map((board) => (
                        <tr key={board.id}>
                          <td>{board.id}</td>
                          <td>
                            <button
                              className="board-title-button"
                              type="button"
                              onClick={() => handleSelectBoard(board.id)}
                            >
                              {board.title}
                            </button>
                          </td>
                          <td>{board.writer}</td>
                          <td>
                            <span className="tag-list">
                              {getBoardTags(board).slice(0, 2).map((boardTag) => (
                                <span className="tag-pill" key={boardTag}>
                                  {boardTag}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td>{board.viewCount}</td>
                          <td>{formatDateFromId(board.id)}</td>
                        </tr>
                      ))}
                      {visibleBoards.length === 0 && (
                        <tr>
                          <td colSpan={6}>게시글이 없습니다.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pagination">
                  <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    이전
                  </button>
                  <span>
                    {page} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={page * limit >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    다음
                  </button>
                </div>
              </div>

              <aside className="side-stack">
                <section className="side-card">
                  <h2>인기 태그</h2>
                  <div className="side-list">
                    {popularTags.map((tag) => (
                      <div className="rank-line" key={tag.name}>
                        <span title={tag.name}>{tag.name}</span>
                        <strong>{tag.count}</strong>
                      </div>
                    ))}
                  </div>
                  {popularTags.length === 0 && <p className="empty-text">아직 태그 데이터가 없습니다.</p>}
                </section>

                <section className="side-card">
                  <h2>최근 댓글</h2>
                  <div className="side-list">
                    {recentComments.map((comment, index) => (
                      <div className="comment-preview" key={comment.id}>
                        <strong>{index + 1}</strong>
                        <span title={comment.boardTitle ? `${comment.boardTitle} · ${comment.content}` : comment.content}>
                          {comment.content}
                        </span>
                      </div>
                    ))}
                  </div>
                  {recentComments.length === 0 && <p className="empty-text">아직 댓글 데이터가 없습니다.</p>}
                </section>
              </aside>
            </div>
          </section>
        )}

        {view === "ai" && (
          <section className="screen ai-screen">
            <div className="two-panel">
              <form className="panel question-panel" onSubmit={handleAskAi}>
                <h1>질문하기</h1>
                <p>AI 멘토에게 궁금한 내용을 질문하고, 근거와 함께 답변을 받아보세요.</p>
                <label htmlFor="ai-question">질문</label>
                <textarea
                  id="ai-question"
                  value={aiQuestion}
                  onChange={(event) => setAiQuestion(event.target.value)}
                  placeholder="정글 학습, 알고리즘, GitHub 저장소에 대해 질문하세요"
                  maxLength={2000}
                  required
                />
                {aiError && <p className="error-text">{aiError}</p>}

                <div className="question-actions">
                  <small>{aiQuestion.length}/2000</small>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setAiQuestion("");
                      setAiError("");
                    }}
                    disabled={isAiLoading || !aiQuestion}
                  >
                    지우기
                  </button>
                  <button className="primary-action" type="submit" disabled={isAiLoading || !aiQuestion}>
                    {isAiLoading ? "답변 생성 중" : "질문하기"}
                  </button>
                </div>

                <div className="notice-box">
                  <p>AI는 지식베이스와 온라인 게시판 내용을 바탕으로 답변합니다.</p>
                  <p>개인 정보나 민감한 정보는 입력하지 마세요.</p>
                </div>
              </form>

              <section className="panel answer-panel">
                <div className="panel-title-row">
                  <h1>AI 답변</h1>
                </div>
                {aiAnswer ? (
                  <>
                    <div className="tool-row">
                      <span className="compass-icon" />
                      <span className="route-badge">{aiAnswer.agentRoute}</span>
                      {aiAnswer.usedTools.map((tool) => (
                        <span className="route-badge" key={tool}>
                          {tool}
                        </span>
                      ))}
                    </div>
                    <article className="answer-box">
                      <MarkdownAnswer text={aiAnswer.answer} />
                    </article>
                    <div className="reference-head">
                      <h2>참고 근거 ({aiAnswer.references.length})</h2>
                    </div>
                    <div className="reference-card-grid">
                      {aiAnswer.references.slice(0, 3).map((reference, index) => {
                        const sourceUrl = reference.sourceUrl ?? reference.repositoryUrl;
                        const body =
                          reference.chunkText ??
                          reference.content ??
                          reference.snippet ??
                          reference.summary ??
                          "근거 내용을 불러왔습니다.";
                        const referenceContent = (
                          <>
                            <span className="tag-pill">{reference.type ?? reference.category ?? "블로그"}</span>
                            <strong>{reference.title ?? "참고 문서"}</strong>
                            <small>{sourceUrl ?? "지식베이스"}</small>
                            <p>{body}</p>
                            {typeof reference.score === "number" && <em>유사도 {reference.score.toFixed(2)}</em>}
                          </>
                        );

                        return sourceUrl ? (
                          <a
                            className="reference-mini"
                            href={sourceUrl}
                            key={`${reference.title ?? index}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {referenceContent}
                          </a>
                        ) : (
                          <article className="reference-mini" key={`${reference.title ?? index}`}>
                            {referenceContent}
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="empty-panel">
                    <span className="compass-icon" />
                    <strong>아직 답변이 없습니다</strong>
                    <p>질문을 보내면 사용 도구, 답변, 참고 근거가 여기에 표시됩니다.</p>
                  </div>
                )}
              </section>
            </div>
          </section>
        )}

        {view === "knowledge" && (
          <section className="screen knowledge-screen">
            <div className="screen-heading">
              <div>
                <h1>지식베이스</h1>
                <p>AI가 답변할 때 참고하는 실제 DB 자료를 확인할 수 있습니다.</p>
              </div>
            </div>

            <div className="knowledge-card-grid">
              {KNOWLEDGE_CARDS.map((card) => (
                <article
                  className={`knowledge-card ${knowledgePreview === card.id ? "is-selected" : ""}`}
                  key={card.id}
                >
                  <CardIconBadge name={card.icon} label={`${card.title} 아이콘`} />
                  <h2>{card.title}</h2>
                  <p>{card.description}</p>
                  <span className="status-chip">정상</span>
                  <div className="card-foot">
                    <span>
                      {card.countLabel} {knowledgeSummary[card.countKey]}개
                    </span>
                    <button type="button" onClick={() => setKnowledgePreview(card.id)}>
                      자료 보기
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <section className="preview-panel">
              <div className="panel-title-row">
                <div>
                  <h2>{selectedKnowledgeCard.title} 자료 목록</h2>
                  <p>{selectedKnowledgeCard.description}에 포함된 참고 자료를 확인합니다.</p>
                </div>
                <span className="status-chip">
                  {selectedKnowledgeCard.countLabel} {selectedKnowledgeCount}개
                </span>
              </div>
              {knowledgeError && <p className="error-text">{knowledgeError}</p>}
              <div className="preview-table">
                <div className="preview-row preview-head">
                  <span>제목</span>
                  <span>출처</span>
                  <span>요약</span>
                  <span>상태</span>
                </div>
                {isKnowledgeLoading && (
                  <div className="preview-row">
                    <strong>자료를 불러오는 중입니다.</strong>
                    <span>-</span>
                    <p>잠시만 기다려주세요.</p>
                    <span>로딩</span>
                  </div>
                )}
                {!isKnowledgeLoading && knowledgeResources.length === 0 && (
                  <div className="preview-row">
                    <strong>표시할 자료가 없습니다.</strong>
                    <span>-</span>
                    <p>현재 선택한 지식베이스에 연결된 DB 자료가 없습니다.</p>
                    <span>비어 있음</span>
                  </div>
                )}
                {!isKnowledgeLoading && visibleKnowledgeResources.map((reference) => (
                  <div className="preview-row" key={reference.title}>
                    <strong>{reference.title}</strong>
                    <span>{reference.source}</span>
                    <p>{reference.summary}</p>
                    <span>{reference.status}</span>
                  </div>
                ))}
              </div>
              {!isKnowledgeLoading && knowledgeResources.length > 5 && (
                <button
                  className="text-action"
                  type="button"
                  onClick={() => setShowAllKnowledgeResources((current) => !current)}
                >
                  {showAllKnowledgeResources ? "문서 접기" : "더 많은 문서 보기"}
                </button>
              )}
            </section>
          </section>
        )}

        {view === "activity" && (
          <section className="screen activity-screen">
            <div className="screen-heading">
              <div>
                <h1>내 활동</h1>
                <p>내가 작성한 글, 댓글, AI 질문, 저장한 자료를 한눈에 확인하세요.</p>
              </div>
            </div>

            <div className="stat-grid">
              {([
                { icon: "posts", label: "내가 쓴 글", value: myBoards.length || 24, hint: "전체 게시글" },
                { icon: "comments", label: "내 댓글", value: comments.length || 87, hint: "전체 댓글" },
                { icon: "ai", label: "AI 질문", value: aiAnswer ? 1 : 18, hint: "전체 질문" },
              ] satisfies StatCardData[]).map(({ icon, label, value, hint }) => (
                <article className="stat-card" key={label}>
                  <CardIconBadge name={icon} label={`${label} 아이콘`} />
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <small>{hint}</small>
                </article>
              ))}
            </div>

          </section>
        )}

        {(view === "write" || view === "edit") && (
          <section className="screen form-screen">
            <div className="screen-heading">
              <div>
                <h1>{view === "write" ? "글쓰기" : "게시글 수정"}</h1>
                <p>질문과 학습 기록을 게시판에 남겨보세요.</p>
              </div>
            </div>
            <form className="board-form" onSubmit={view === "write" ? handleCreateBoard : handleUpdateBoard}>
              <label htmlFor="board-title-input">제목</label>
              <input
                id="board-title-input"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="제목을 입력하세요"
              />

              <label htmlFor="board-tag-input">태그</label>
              <div className="board-tag-options">
                {tagOptions.map((tagName) => (
                  <button
                    className={selectedTags.includes(tagName) ? "is-selected" : ""}
                    type="button"
                    key={tagName}
                    onClick={() => toggleTag(tagName)}
                  >
                    {tagName}
                  </button>
                ))}
              </div>
              <div className="tag-add-row">
                <input
                  id="board-tag-input"
                  type="text"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="새 태그 추가"
                />
                <button type="button" onClick={() => addTag(tagDraft)}>
                  추가
                </button>
              </div>

              <label htmlFor="board-content-input">내용</label>
              <textarea
                id="board-content-input"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="내용을 입력하세요"
              />

              <div className="form-actions">
                <button className="primary-action" type="submit" disabled={isBoardFormDisabled}>
                  {view === "write" ? "등록" : "수정 저장"}
                </button>
                <button type="button" onClick={goToBoard}>
                  취소
                </button>
              </div>
            </form>
          </section>
        )}

        {view === "detail" && selectedBoard && (
          <section className="screen detail-screen">
            <div className="detail-card">
              <div className="screen-heading">
                <div>
                  <h1>{selectedBoard.title}</h1>
                  <p>
                    작성자 {selectedBoard.writer} · 조회수 {selectedBoard.viewCount}
                  </p>
                </div>
                <button type="button" onClick={goToBoard}>
                  목록
                </button>
              </div>
              <div className="tag-list">
                {getBoardTags(selectedBoard).map((tag) => (
                  <span className="tag-pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <article className="board-content">{selectedBoard.content}</article>
              <div className="detail-actions">
                {selectedBoard.writer === loginId && (
                  <>
                    <button type="button" onClick={() => startEdit(selectedBoard)}>
                      수정
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(selectedBoard)}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            </div>

            <section className="panel comment-section">
              <h2>댓글</h2>
              <form onSubmit={handleCreateComment}>
                <input
                  type="text"
                  value={commentContent}
                  onChange={(event) => setCommentContent(event.target.value)}
                  placeholder="댓글을 입력하세요"
                />
                <button type="submit" disabled={commentContent === ""}>
                  댓글 작성
                </button>
              </form>
              <ul>
                {comments.map((comment) => (
                  <li key={comment.id}>
                    <span>
                      <strong>{comment.writer}</strong> {comment.content}
                    </span>
                    {comment.writer === loginId && (
                      <button type="button" onClick={() => handleDeleteComment(comment.id)}>
                        삭제
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </section>
        )}

        {deleteTarget && (
          <div className="board-modal-backdrop" role="presentation">
            <div className="board-modal" role="dialog" aria-modal="true">
              <h2>게시글을 삭제하시겠습니까?</h2>
              <div className="form-actions">
                <button type="button" onClick={handleDeleteBoard}>
                  삭제
                </button>
                <button type="button" onClick={() => setDeleteTarget(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default BoardPage;
