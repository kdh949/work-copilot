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

export const BoardPage = ({ loginId }: BoardPageProps) => {
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const limit = 10;
  const [isWriting, setIsWriting] = React.useState(false);
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

  const isDisabled = title === "" || content === "" || tag === "";

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

  async function fetchBoards() {
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
  }
  // page가 바뀔떄마다 목록을 다시 가져온다.
  React.useEffect(() => {
    fetchBoards();
    // 감시 목록 두개 둘중 어느 하나가 바뀌어도 fetchBoards() 실행
  }, [page, searchKeyword]);

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

    setTitle("");
    setContent("");
    setTag("");
    setMessage(`${loginId}님 게시글 작성 완료`);
    setIsWriting(false);
    fetchBoards();
  }

  function startEdit(board: Board) {
    setEditingBoardId(board.id);
    setTitle(board.title);
    setContent(board.content);
    setTag(board.tag);
    setIsWriting(false);
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
    fetchBoards();
  }

  async function handleDeleteBoard(id: number) {
    const response = await authJsonFetch(`http://localhost:3000/boards/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setMessage("게시글 삭제 실패");
      return;
    }

    setMessage("게시글 삭제 완료");
    fetchBoards();
  }

  return (
    <main className="board-page">
      <div className="board-header">
        <h1>게시판</h1>
        {/* 검색용 form */}
        <form
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
            placeholder="제목/내용 검색"
          />
          <button type="submit">검색</button>
        </form>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setIsWriting(true);
          }}
        >
          글쓰기
        </button>
      </div>

      {isWriting && (
        <form className="board-form" onSubmit={handleCreateBoard}>
          <div>
            <label htmlFor="board-title-input">제목:</label>
            <input
              id="board-title-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="board-tag-input">태그:</label>
            <input
              id="board-tag-input"
              type="text"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="board-content-input">내용:</label>
            <textarea
              id="board-content-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>

          <button type="submit" disabled={isDisabled}>
            저장
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsWriting(false);
            }}
          >
            취소
          </button>
        </form>
      )}

      {editingBoardId !== null && (
        <form className="board-form" onSubmit={handleUpdateBoard}>
          <div>
            <label htmlFor="edit-board-title-input">제목:</label>
            <input
              id="edit-board-title-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="edit-board-tag-input">태그:</label>
            <input
              id="edit-board-tag-input"
              type="text"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="edit-board-content-input">내용:</label>
            <textarea
              id="edit-board-content-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>

          <button type="submit" disabled={isDisabled}>
            수정 저장
          </button>
          <button type="button" onClick={resetForm}>
            취소
          </button>
        </form>
      )}

      <p>{message}</p>

      {selectedBoard && (
        <section className="board-detail">
          <h2>{selectedBoard.title}</h2>
          <p>{selectedBoard.content}</p>
          <div className="board-detail-meta">
            <span>
              {selectedBoard.tag} / 작성자: {selectedBoard.writer} / 조회수:{" "}
              {selectedBoard.viewCount}
            </span>
            <button type="button" onClick={() => setSelectedBoard(null)}>
              닫기
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

      <ul className="board-list">
        {boards.map((board) => (
          <li key={board.id}>
            <button
              className="board-title-button"
              type="button"
              onClick={() => handleSelectBoard(board.id)}
            >
              {board.title}
            </button>
            <span>
              {board.tag} / 작성자: {board.writer} / 조회수: {board.viewCount}
            </span>

            {board.writer === loginId && (
              <div className="board-actions">
                <button type="button" onClick={() => startEdit(board)}>
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteBoard(board.id)}
                >
                  삭제
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="board-pagination">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          이전
        </button>

        <span>
          {page} / {Math.ceil(total / limit)}
        </span>

        <button
          type="button"
          disabled={page * limit >= total}
          onClick={() => setPage(page + 1)}
        >
          다음
        </button>
      </div>
    </main>
  );
};

export default BoardPage;
