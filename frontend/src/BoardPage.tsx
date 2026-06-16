import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

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
const KNOWLEDGE_CARDS = [
  { id: "faq", title: "FAQ Bot", description: "자주 묻는 질문 답변 모음", count: 42 },
  { id: "blog", title: "블로그 검색", description: "정글 후기를 RAG 문서로", count: 128 },
  { id: "github", title: "GitHub 분석", description: "GitHub 저장소 분석 자료", count: 67 },
  { id: "board", title: "게시판 근거", description: "게시판 글과 댓글 데이터", count: 356 },
];

const SAMPLE_REFERENCES = [
  {
    title: "정글 알고리즘 완벽 가이드",
    source: "jungle-dev.tistory.com",
    summary: "배열 정렬부터 동적계획까지 주요 정글 알고리즘의 원리와 성능을 정리했습니다.",
    score: "0.93",
  },
  {
    title: "크래프톤 정글 5주차 핵심 정리",
    source: "dev-log.kr",
    summary: "그래프 탐색의 특징, 시간 복잡도, 구현 팁을 정리했습니다.",
    score: "0.88",
  },
  {
    title: "JavaScript로 배우는 정렬 알고리즘",
    source: "codeandrun.dev",
    summary: "자바스크립트 코드 예제와 함께 각 정렬 알고리즘을 설명합니다.",
    score: "0.86",
  },
  {
    title: "자료구조와 함께 보는 정렬",
    source: "algorithm-lab.com",
    summary: "자료구조 관점에서 정렬 알고리즘을 비교 분석합니다.",
    score: "0.83",
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
  const [commentContent, setCommentContent] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [searchKeyword, setSearchKeyword] = React.useState("");
  const [activeTag, setActiveTag] = React.useState("전체");
  const [deleteTarget, setDeleteTarget] = React.useState<Board | null>(null);
  const [aiQuestion, setAiQuestion] = React.useState("");
  const [aiAnswer, setAiAnswer] = React.useState<AiAnswer | null>(null);
  const [aiError, setAiError] = React.useState("");
  const [isAiLoading, setIsAiLoading] = React.useState(false);
  const [knowledgePreview, setKnowledgePreview] = React.useState("blog");

  const limit = 10;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const isBoardFormDisabled = title === "" || content === "" || selectedTags.length === 0;
  const myBoards = boards.filter((board) => board.writer === loginId);
  const visibleBoards =
    activeTag === "전체"
      ? boards
      : boards.filter((board) => getBoardTags(board).includes(activeTag));

  const fetchBoards = React.useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      keyword: searchKeyword,
    });
    const response = await fetch(`http://localhost:3000/boards?${params}`);
    const data = await response.json();

    setBoards(data.items ?? []);
    setTotal(data.total ?? 0);
  }, [page, searchKeyword]);

  const fetchTagOptions = React.useCallback(async () => {
    const response = await fetch("http://localhost:3000/boards/tags");

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
      const response = await fetch(`http://localhost:3000/boards/${boardId}`);

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
    const response = await fetch(`http://localhost:3000/comments?boardId=${boardId}`);

    if (!response.ok) {
      setMessage("댓글 조회 실패");
      return;
    }

    const data = await response.json();
    setComments(data);
  }

  async function handleSelectBoard(id: number) {
    const response = await fetch(`http://localhost:3000/boards/${id}`);

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

    const response = await authJsonFetch("http://localhost:3000/boards", {
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

    const response = await authJsonFetch(`http://localhost:3000/boards/${editingBoardId}`, {
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

    const response = await authJsonFetch(`http://localhost:3000/boards/${deleteTarget.id}`, {
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

    const response = await authJsonFetch("http://localhost:3000/comments", {
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
    const response = await authJsonFetch(`http://localhost:3000/comments/${id}`, {
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
      const response = await authJsonFetch("http://localhost:3000/ai/ask", {
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
          <button className="icon-button" type="button" aria-label="알림">
            !
          </button>
          <span className="user-dot">J</span>
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
                  {["알고리즘", "프로젝트", "GitHub", "백엔드", "NestJS"].map((tag, index) => (
                    <div className="rank-line" key={tag}>
                      <span>{tag}</span>
                      <strong>{[82, 56, 47, 41, 31][index]}</strong>
                    </div>
                  ))}
                  <button type="button">더보기</button>
                </section>

                <section className="side-card">
                  <h2>최근 댓글</h2>
                  {comments.slice(0, 3).map((comment, index) => (
                    <div className="comment-preview" key={comment.id}>
                      <strong>{index + 1}</strong>
                      <span>{comment.content}</span>
                    </div>
                  ))}
                  {comments.length === 0 &&
                    ["좋은 정리 감사합니다!", "저도 이 방법 쓰는데요", "분할정복 팁 공유해주세요!"].map(
                      (text, index) => (
                        <div className="comment-preview" key={text}>
                          <strong>{index + 1}</strong>
                          <span>{text}</span>
                        </div>
                      ),
                    )}
                  <button type="button">더보기</button>
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
                <small>{aiQuestion.length}/2000</small>

                {aiError && <p className="error-text">{aiError}</p>}

                <button className="primary-action" type="submit" disabled={isAiLoading || !aiQuestion}>
                  {isAiLoading ? "답변 생성 중" : "질문하기"}
                </button>

                <div className="notice-box">
                  <p>AI는 지식베이스와 온라인 게시판 내용을 바탕으로 답변합니다.</p>
                  <p>개인 정보나 민감한 정보는 입력하지 마세요.</p>
                </div>
              </form>

              <section className="panel answer-panel">
                <div className="panel-title-row">
                  <h1>AI 답변</h1>
                  <span className="status-chip">완료</span>
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

                        return (
                          <article className="reference-mini" key={`${reference.title ?? index}`}>
                            <span className="tag-pill">{reference.type ?? reference.category ?? "블로그"}</span>
                            <strong>{reference.title ?? "참고 문서"}</strong>
                            <small>{sourceUrl ?? "지식베이스"}</small>
                            <p>{body}</p>
                            {typeof reference.score === "number" && <em>유사도 {reference.score.toFixed(2)}</em>}
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
                <p>AI가 답변할 때 참고하는 문서와 자료를 확인할 수 있습니다.</p>
              </div>
              <button type="button">지식베이스 관리</button>
            </div>

            <div className="knowledge-card-grid">
              {KNOWLEDGE_CARDS.map((card) => (
                <article
                  className={`knowledge-card ${knowledgePreview === card.id ? "is-selected" : ""}`}
                  key={card.id}
                >
                  <span className="card-icon">{card.title.slice(0, 1)}</span>
                  <h2>{card.title}</h2>
                  <p>{card.description}</p>
                  <span className="status-chip">정상</span>
                  <div className="card-foot">
                    <span>문서 {card.count}개</span>
                    <button type="button" onClick={() => setKnowledgePreview(card.id)}>
                      미리보기
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <section className="preview-panel">
              <div className="panel-title-row">
                <h2>
                  {KNOWLEDGE_CARDS.find((card) => card.id === knowledgePreview)?.title} 미리보기
                </h2>
                <button type="button">닫기</button>
              </div>
              <div className="preview-table">
                <div className="preview-row preview-head">
                  <span>제목</span>
                  <span>출처</span>
                  <span>요약</span>
                  <span>유사도</span>
                  <span>작업</span>
                </div>
                {SAMPLE_REFERENCES.map((reference) => (
                  <div className="preview-row" key={reference.title}>
                    <strong>{reference.title}</strong>
                    <span>{reference.source}</span>
                    <p>{reference.summary}</p>
                    <span>{reference.score}</span>
                    <button type="button" onClick={() => goToTab("ai")}>
                      AI 질문에 사용
                    </button>
                  </div>
                ))}
              </div>
              <a href="#more">더 많은 문서 보기</a>
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
              {[
                ["내가 쓴 글", myBoards.length || 24, "전체 게시글"],
                ["내 댓글", comments.length || 87, "전체 댓글"],
                ["AI 질문", aiAnswer ? 1 : 18, "전체 질문"],
                ["저장한 참고 근거", 32, "전체 저장"],
              ].map(([label, value, hint]) => (
                <article className="stat-card" key={label}>
                  <span className="card-icon">{String(label).slice(0, 1)}</span>
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <small>{hint}</small>
                </article>
              ))}
            </div>

            <div className="activity-layout">
              <section className="panel">
                <h2>최근 활동</h2>
                {[
                  ["AI 질문", aiAnswer?.question ?? "정렬 알고리즘 성능 비교 방법", "AI 답변 보기"],
                  ["게시글", boards[0]?.title ?? "Docker와 Docker Compose 차이 정리", "게시글 보기"],
                  ["댓글", comments[0]?.content ?? "댓글을 남겼습니다", "댓글 보기"],
                  ["저장", "퀵 정렬과 병합 정렬 비교", "자료 보기"],
                ].map(([kind, text, action]) => (
                  <div className="timeline-item" key={`${kind}-${text}`}>
                    <span className="timeline-dot" />
                    <span className="tag-pill">{kind}</span>
                    <strong>{text}</strong>
                    <button type="button">{action}</button>
                  </div>
                ))}
                <button type="button">더 많은 활동 보기</button>
              </section>

              <aside className="side-stack">
                <section className="side-card saved-card">
                  <h2>저장한 참고 근거</h2>
                  {SAMPLE_REFERENCES.slice(0, 3).map((reference) => (
                    <article className="saved-reference" key={reference.title}>
                      <span className="tag-pill">블로그</span>
                      <strong>{reference.title}</strong>
                      <small>{reference.source}</small>
                    </article>
                  ))}
                </section>
                <section className="side-card quick-links">
                  <h2>바로가기</h2>
                  <button type="button" onClick={() => goToTab("board")}>
                    게시판 목록
                  </button>
                  <button type="button" onClick={() => goToTab("ai")}>
                    AI 질문하기
                  </button>
                </section>
              </aside>
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
