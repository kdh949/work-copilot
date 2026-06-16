import React from "react";
// 게시글 작성 수정 삭제에 공통된 코드 함수로 만듬
function authJsonFetch(url: string, options: RequestInit = {}) {
  const accessToken = localStorage.getItem("accessToken");

  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      // Bearer는 "토큰 인증 방식"이라는 표시
      // Bearer 뒤에는 실제 accessToken을 붙임
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

type Board = {
  id: number;
  title: string;
  content: string;
  // tag는 예전 서버 응답과의 호환용입니다.
  tag?: string;
  // 새 구조에서는 글 하나가 여러 태그를 가질 수 있습니다.
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

type BoardPageProps = {
  loginId: string;
};

type BoardView = "list" | "write" | "edit" | "detail";

// DB에 아직 태그가 없어도 처음 화면에서 고를 수 있게 기본 태그를 준비합니다.
const DEFAULT_TAG_OPTIONS = ["알고리즘", "정글", "입학준비", "후기", "질문"];

export const BoardPage = ({ loginId }: BoardPageProps) => {
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const limit = 10;
  const [view, setView] = React.useState<BoardView>("list");
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  // 사용자가 현재 글에 붙이기로 선택한 태그 목록입니다.
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  // 사용자가 새 태그를 직접 입력하는 임시 입력값입니다.
  const [tagDraft, setTagDraft] = React.useState("");
  // 선택 버튼으로 보여줄 태그 후보 목록입니다.
  const [tagOptions, setTagOptions] = React.useState(DEFAULT_TAG_OPTIONS);
  const [message, setMessage] = React.useState("");
  const [editingBoardId, setEditingBoardId] = React.useState<number | null>(
    null,
  );
  const [selectedBoard, setSelectedBoard] = React.useState<Board | null>(null);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [commentContent, setCommentContent] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [searchKeyword, setSearchKeyword] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<Board | null>(null);

  const isDisabled = title === "" || content === "" || selectedTags.length === 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  function getBoardTags(board: Board) {
    // 새 응답은 tags 배열을 쓰고, 예전 응답은 tag 문자열을 쓸 수 있어서 둘 다 처리합니다.
    return board.tags?.length ? board.tags : board.tag ? [board.tag] : [];
  }

  function addTag(tagName: string) {
    // 새 태그를 선택 목록에 추가합니다.
    // 이미 선택한 태그면 중복으로 넣지 않습니다.
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
    // 선택된 태그 칩을 누르면 해당 태그를 선택 목록에서 뺍니다.
    setSelectedTags((current) => current.filter((tag) => tag !== tagName));
  }

  function toggleTag(tagName: string) {
    // 태그 버튼을 한 번 누르면 선택, 다시 누르면 해제합니다.
    if (selectedTags.includes(tagName)) {
      removeTag(tagName);
    } else {
      addTag(tagName);
    }
  }

  const fetchBoards = React.useCallback(async () => {
    // URL 뒤에 붙는 query string을 만들기 위한 코드이다.
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      keyword: searchKeyword,
    });
    // await는 fetch가 끝날 때까지 기다린다
    // await가 없으면 서버 응답이 오기 전에 다음 코드가 실행 될 수 있다.
    const response = await fetch(`http://localhost:3000/boards?${params}`);
    const data = await response.json();

    setBoards(data.items);
    setTotal(data.total);
  }, [page, searchKeyword]);

  const fetchTagOptions = React.useCallback(async () => {
    // 서버에 저장된 태그 목록을 가져와서 기본 태그와 합칩니다.
    const response = await fetch("http://localhost:3000/boards/tags");

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    setTagOptions([...new Set([...DEFAULT_TAG_OPTIONS, ...data])]);
  }, []);

  function goToList() {
    setView("list");
    setSelectedBoard(null);
    setDeleteTarget(null);
    setCommentContent("");
    resetForm();
  }

  // 상세 조회 함수
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
    setView("detail");
    setMessage("");
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
    const response = await authJsonFetch(
      `http://localhost:3000/comments/${id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      setMessage("댓글 삭제 실패");
      return;
    }

    if (selectedBoard) {
      fetchComments(selectedBoard.id);
    }
  }

  async function fetchComments(boardId: number) {
    const response = await fetch(
      `http://localhost:3000/comments?boardId=${boardId}`,
    );

    if (!response.ok) {
      setMessage("댓글 조회 실패");
      return;
    }

    const data = await response.json();
    setComments(data);
  }

  // page가 바뀔떄마다 목록을 다시 가져온다.
  React.useEffect(() => {
    void Promise.resolve().then(fetchBoards);
    // 감시 목록 두개 둘중 어느 하나가 바뀌어도 fetchBoards() 실행
  }, [fetchBoards]);

  React.useEffect(() => {
    // 화면이 처음 열릴 때 태그 선택지를 가져옵니다.
    void Promise.resolve().then(fetchTagOptions);
  }, [fetchTagOptions]);

  async function handleCreateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await authJsonFetch("http://localhost:3000/boards", {
      method: "POST",
      body: JSON.stringify({
        title,
        content,
        // 서버에는 태그 여러 개를 배열로 보냅니다.
        tags: selectedTags,
        writer: loginId,
      }),
    });

    if (!response.ok) {
      setMessage("게시글 작성 실패");
      return;
    }

    const newBoard = await response.json();
    setTitle("");
    setContent("");
    setSelectedTags([]);
    setMessage(`${loginId}님 게시글 작성 완료`);
    setSelectedBoard(newBoard);
    fetchComments(newBoard.id);
    setView("detail");
    fetchBoards();
  }

  function startEdit(board: Board) {
    setEditingBoardId(board.id);
    setTitle(board.title);
    setContent(board.content);
    setSelectedTags(getBoardTags(board));
    setView("edit");
    setMessage("");
  }

  function resetForm() {
    setEditingBoardId(null);
    setTitle("");
    setContent("");
    setSelectedTags([]);
    setTagDraft("");
  }

  async function handleUpdateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (editingBoardId === null) {
      return;
    }

    const response = await authJsonFetch(
      `http://localhost:3000/boards/${editingBoardId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title,
          content,
          // 수정할 때도 선택된 태그 전체를 서버에 보냅니다.
          tags: selectedTags,
        }),
      },
    );

    if (!response.ok) {
      setMessage("게시글 수정 실패");
      return;
    }

    resetForm();
    setMessage("게시글 수정 완료");
    if (selectedBoard?.id === editingBoardId) {
      handleSelectBoard(editingBoardId);
    } else {
      setView("list");
    }
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
    goToList();
    fetchBoards();
  }

  return (
    <main className="board-page">
      <div className="board-header">
        <button className="board-brand" type="button" onClick={goToList}>
          게시판
        </button>
        <div className="board-header-actions">
          <span>{loginId}님</span>
          {view !== "list" && (
            <button type="button" onClick={goToList}>
              목록
            </button>
          )}
        </div>
      </div>

      <p className="board-message">{message}</p>

      {view === "list" && (
        <section className="board-panel">
          <div className="board-list-header">
            <h1>게시글 목록</h1>
            {/* 검색용 form */}
            <form
              className="board-search"
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
                placeholder="검색어를 입력하세요"
              />
              <button type="submit">검색</button>
            </form>
          </div>

          <div className="board-table-wrap">
            <table className="board-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>제목</th>
                  <th>작성자</th>
                  <th>태그</th>
                  <th>조회수</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((board) => (
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
                      <div className="board-tag-list">
                        {/* 게시글마다 여러 태그를 작은 칩으로 보여줍니다. */}
                        {getBoardTags(board).map((boardTag) => (
                          <span className="board-tag" key={boardTag}>
                            {boardTag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{board.viewCount}</td>
                  </tr>
                ))}
                {boards.length === 0 && (
                  <tr>
                    <td colSpan={5}>게시글이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="board-bottom-bar">
            <p>글쓰기는 로그인 후 이용 가능합니다.</p>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setMessage("");
                setView("write");
              }}
            >
              글쓰기
            </button>
          </div>

          <div className="board-pagination">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
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
        </section>
      )}

      {(view === "write" || view === "edit") && (
        <section className="board-panel board-form-panel">
          <h1>{view === "write" ? "글쓰기" : "게시글 수정"}</h1>
          <form
            className="board-form"
            onSubmit={view === "write" ? handleCreateBoard : handleUpdateBoard}
          >
            <div>
              <label htmlFor="board-title-input">제목</label>
              <input
                id="board-title-input"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="제목을 입력하세요"
              />
            </div>

            <div>
              <label htmlFor="board-tag-input">태그</label>
              <div className="board-tag-picker">
                <div className="board-tag-options">
                  {tagOptions.map((tagName) => {
                    // 이미 선택한 태그는 선택된 모양으로 보여줍니다.
                    const isSelected = selectedTags.includes(tagName);

                    return (
                      <button
                        className={`board-tag-option ${isSelected ? "is-selected" : ""}`}
                        type="button"
                        key={tagName}
                        onClick={() => toggleTag(tagName)}
                      >
                        {tagName}
                      </button>
                    );
                  })}
                </div>

                <div className="board-tag-add">
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

                <div className="board-selected-tags">
                  {selectedTags.map((tagName) => (
                    // 선택된 태그를 누르면 제거됩니다.
                    <button
                      className="board-tag is-removable"
                      type="button"
                      key={tagName}
                      onClick={() => removeTag(tagName)}
                    >
                      {tagName}
                    </button>
                  ))}
                  {selectedTags.length === 0 && (
                    <span className="board-tag-empty">태그를 하나 이상 선택하세요.</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="board-content-input">내용</label>
              <textarea
                id="board-content-input"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="내용을 입력하세요"
              />
            </div>

            <div className="board-form-actions">
              <button type="submit" disabled={isDisabled}>
                {view === "write" ? "등록" : "수정 저장"}
              </button>
              <button type="button" onClick={goToList}>
                취소
              </button>
            </div>
          </form>
        </section>
      )}

      {view === "detail" && selectedBoard && (
        <section className="board-panel board-detail">
          <h1>{selectedBoard.title}</h1>
          <div className="board-detail-meta">
            <span>작성자 {selectedBoard.writer}</span>
            <span>
              태그{" "}
              <span className="board-tag-list">
                {/* 상세 화면에서도 여러 태그를 한 줄에 보여줍니다. */}
                {getBoardTags(selectedBoard).map((boardTag) => (
                  <span className="board-tag" key={boardTag}>
                    {boardTag}
                  </span>
                ))}
              </span>
            </span>
            <span>조회수 {selectedBoard.viewCount}</span>
          </div>

          <article className="board-content">{selectedBoard.content}</article>

          <div className="board-detail-actions">
            {selectedBoard.writer === loginId && (
              <>
                <button type="button" onClick={() => startEdit(selectedBoard)}>
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(selectedBoard)}
                >
                  삭제
                </button>
              </>
            )}
            <button type="button" onClick={goToList}>
              목록
            </button>
          </div>

          <div className="comment-section">
            <h3>댓글</h3>

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
                    {comment.writer}: {comment.content}
                  </span>

                  {comment.writer === loginId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(comment.id)}
                    >
                      삭제
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {deleteTarget && (
        <div className="board-modal-backdrop" role="presentation">
          <div
            className="board-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-board-title"
          >
            <h2 id="delete-board-title">게시글을 삭제하시겠습니까?</h2>
            <div className="board-modal-actions">
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
  );
};

export default BoardPage;
