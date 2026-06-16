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
  tag: string;
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

export const BoardPage = ({ loginId }: BoardPageProps) => {
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const limit = 10;
  const [view, setView] = React.useState<BoardView>("list");
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [tag, setTag] = React.useState("");
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

  const isDisabled = title === "" || content === "" || tag === "";
  const pageCount = Math.max(1, Math.ceil(total / limit));

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

  async function handleCreateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await authJsonFetch("http://localhost:3000/boards", {
      method: "POST",
      body: JSON.stringify({
        title,
        content,
        tag,
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
    setTag("");
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
    setTag(board.tag);
    setView("edit");
    setMessage("");
  }

  function resetForm() {
    setEditingBoardId(null);
    setTitle("");
    setContent("");
    setTag("");
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
          tag,
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
                    <td>{board.tag}</td>
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
              <input
                id="board-tag-input"
                type="text"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="태그를 입력하세요"
              />
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
            <span>태그 {selectedBoard.tag}</span>
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
