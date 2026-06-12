import React from "react";

type Board = {
  id: number;
  title: string;
  content: string;
  tag: string;
  writer: string;
};

type BoardPageProps = {
  loginId: string;
};

export const BoardPage = ({ loginId }: BoardPageProps) => {
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [isWriting, setIsWriting] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [editingBoardId, setEditingBoardId] = React.useState<number | null>(
    null,
  );

  const isDisabled = title === "" || content === "" || tag === "";

  async function fetchBoards() {
    const response = await fetch("http://localhost:3000/boards");
    const data = await response.json();
    setBoards(data);
  }

  React.useEffect(() => {
    fetchBoards();
  }, []);

  async function handleCreateBoard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch("http://localhost:3000/boards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

    const response = await fetch(
      `http://localhost:3000/boards/${editingBoardId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
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
    const response = await fetch(`http://localhost:3000/boards/${id}`, {
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

      <ul className="board-list">
        {boards.map((board) => (
          <li key={board.id}>
            <strong>{board.title}</strong>
            <span>
              {board.tag} / 작성자: {board.writer}
            </span>
            <p>{board.content}</p>
            {board.writer === loginId && (
              <div className="board-actions">
                <button type="button" onClick={() => startEdit(board)}>
                  수정
                </button>
                <button type="button" onClick={() => handleDeleteBoard(board.id)}>
                  삭제
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
};

export default BoardPage;
