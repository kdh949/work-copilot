import asyncpg

from app.core.config import settings
from app.services.indexing_service import index_text_document


async def get_connection():
    # AI 서버와 백엔드가 같은 PostgreSQL을 보므로 게시글/댓글을 직접 읽을 수 있습니다.
    return await asyncpg.connect(settings.database_url)


def build_board_content(row: asyncpg.Record) -> str:
    # 제목, 작성자, 태그, 본문을 한 문서로 묶어 RAG 검색 근거로 저장합니다.
    tags = ", ".join(row["tags"] or [])
    return "\n".join(
        [
            f"게시글 제목: {row['title']}",
            f"작성자: {row['writer']}",
            f"태그: {tags}" if tags else "태그: 없음",
            "",
            row["content"],
        ]
    )


def build_comment_content(row: asyncpg.Record) -> str:
    # 댓글만 저장하면 맥락이 부족하므로 게시글 제목과 번호를 함께 넣습니다.
    return "\n".join(
        [
            f"댓글이 달린 게시글: {row['board_title'] or row['board_id']}",
            f"게시글 번호: {row['board_id']}",
            f"댓글 작성자: {row['writer']}",
            "",
            row["content"],
        ]
    )


async def index_board_record(row: asyncpg.Record) -> dict:
    return await index_text_document(
        title=f"게시글: {row['title']}",
        content=build_board_content(row),
        source_type="BOARD",
        source_url=f"board://{row['id']}",
        discovered_by="backend_board",
    )


async def index_comment_record(row: asyncpg.Record) -> dict:
    return await index_text_document(
        title=f"댓글: {row['board_title'] or row['board_id']} #{row['id']}",
        content=build_comment_content(row),
        source_type="COMMENT",
        source_url=f"comment://{row['id']}",
        discovered_by="backend_comment",
    )


async def sync_boards_and_comments() -> dict:
    # 24시간 자동 작업에서 전체 게시글/댓글을 훑되, 변경 없는 문서는 skipped 됩니다.
    conn = await get_connection()
    indexed: list[dict] = []
    failed: list[dict] = []

    try:
        board_rows = await conn.fetch(
            """
            SELECT
                b.id,
                b.title,
                b.content,
                b.writer,
                COALESCE(array_agg(t.name ORDER BY t.name)
                    FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
            FROM board b
            LEFT JOIN board_tags bt ON bt.board_id = b.id
            LEFT JOIN tag t ON t.id = bt.tag_id
            GROUP BY b.id
            ORDER BY b.id ASC;
            """
        )

        comment_rows = await conn.fetch(
            """
            SELECT
                c.id,
                c."boardId" AS board_id,
                c.content,
                c.writer,
                b.title AS board_title
            FROM comment c
            LEFT JOIN board b ON b.id = c."boardId"
            ORDER BY c.id ASC;
            """
        )
    finally:
        await conn.close()

    for row in board_rows:
        try:
            indexed.append(await index_board_record(row))
        except Exception as error:
            failed.append({"sourceUrl": f"board://{row['id']}", "error": str(error)})

    for row in comment_rows:
        try:
            indexed.append(await index_comment_record(row))
        except Exception as error:
            failed.append({"sourceUrl": f"comment://{row['id']}", "error": str(error)})

    return {
        "status": "ok",
        "indexedCount": len(indexed),
        "failedCount": len(failed),
        "indexed": indexed,
        "failed": failed,
    }
