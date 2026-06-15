import asyncpg

from app.core.config import settings


def to_pgvector(embedding: list[float]) -> str:
    # Python의 숫자 리스트를 pgvector가 이해하는 문자열로 바꿉니다.
    # 예: [0.1, 0.2, 0.3] -> "[0.1,0.2,0.3]"
    return "[" + ",".join(str(value) for value in embedding) + "]"


async def get_connection():
    # PostgreSQL에 연결합니다.
    # 주소는 ai-server/.env의 DATABASE_URL을 사용합니다.
    return await asyncpg.connect(settings.database_url)


async def init_vector_tables() -> None:
    # RAG에 필요한 테이블을 없으면 새로 만듭니다.
    conn = await get_connection()

    try:
        # pgvector 기능을 켭니다.
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        # gen_random_uuid()로 id를 만들 수 있게 준비합니다.
        await conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")

        # 원본 문서를 저장하는 테이블입니다.
        # 블로그 URL 하나, GitHub README 하나가 document 한 개가 됩니다.
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT UNIQUE,
                content_hash TEXT,
                discovered_by TEXT DEFAULT 'manual',
                search_keyword TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            """
        )

        # document를 작게 자른 chunk를 저장하는 테이블입니다.
        # RAG 검색은 보통 문서 전체가 아니라 이 chunk 단위로 합니다.
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_document_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                chunk_text TEXT NOT NULL,
                embedding vector(1536),
                created_at TIMESTAMPTZ DEFAULT now()
            );
            """
        )

        # 나중에 source_url로 중복 문서를 빠르게 찾기 위한 index입니다.
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ai_documents_source_url
            ON ai_documents(source_url);
            """
        )

        # vector 검색을 빠르게 하기 위한 index입니다.
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_embedding
            ON ai_document_chunks
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
            """
        )
    finally:
        # DB 연결을 다 썼으면 닫습니다.
        await conn.close()


async def preview_init_vector_tables() -> dict:
    # API에서 테이블 생성을 쉽게 호출하기 위한 함수입니다.
    # 성공하면 어떤 테이블을 준비했는지 알려줍니다.
    await init_vector_tables()

    return {
        "status": "ok",
        "message": "Vector tables are ready.",
        "tables": ["ai_documents", "ai_document_chunks"],
    }


async def save_indexed_document(
    title: str,
    content: str,
    source_type: str,
    source_url: str,
    content_hash: str,
    chunks: list[str],
    embeddings: list[list[float]],
    discovered_by: str = "manual",
    search_keyword: str | None = None,
) -> dict:
    # URL 하나를 문서 1개로 저장하고, 그 문서를 자른 chunk들도 같이 저장합니다.
    # 이미 같은 URL과 같은 내용이 저장되어 있으면 다시 저장하지 않고 skipped로 끝냅니다.
    conn = await get_connection()

    try:
        async with conn.transaction():
            # 같은 URL이 이미 저장되어 있는지 확인합니다.
            existing = await conn.fetchrow(
                """
                SELECT id::text AS id, content_hash
                FROM ai_documents
                WHERE source_url = $1;
                """,
                source_url,
            )

            if existing and existing["content_hash"] == content_hash:
                # 내용이 바뀌지 않았다면 chunk를 다시 만들 필요가 없습니다.
                chunk_count = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM ai_document_chunks
                    WHERE document_id = $1::uuid;
                    """,
                    existing["id"],
                )

                return {
                    "status": "skipped",
                    "documentId": existing["id"],
                    "chunkCount": chunk_count,
                    "reason": "same content already indexed",
                }

            if existing:
                # 같은 URL인데 내용이 바뀌었다면 문서 내용을 업데이트합니다.
                document_id = await conn.fetchval(
                    """
                    UPDATE ai_documents
                    SET title = $1,
                        content = $2,
                        source_type = $3,
                        content_hash = $4,
                        discovered_by = $5,
                        search_keyword = $6,
                        updated_at = now()
                    WHERE id = $7::uuid
                    RETURNING id::text;
                    """,
                    title,
                    content,
                    source_type,
                    content_hash,
                    discovered_by,
                    search_keyword,
                    existing["id"],
                )

                # 예전 chunk는 지우고 새 chunk로 다시 저장합니다.
                await conn.execute(
                    """
                    DELETE FROM ai_document_chunks
                    WHERE document_id = $1::uuid;
                    """,
                    document_id,
                )
                status = "updated"
            else:
                # 처음 보는 URL이면 새 문서로 저장합니다.
                document_id = await conn.fetchval(
                    """
                    INSERT INTO ai_documents (
                        title,
                        content,
                        source_type,
                        source_url,
                        content_hash,
                        discovered_by,
                        search_keyword
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id::text;
                    """,
                    title,
                    content,
                    source_type,
                    source_url,
                    content_hash,
                    discovered_by,
                    search_keyword,
                )
                status = "created"

            # chunk와 embedding은 순서가 서로 맞아야 합니다.
            # chunks[0]의 embedding은 embeddings[0]입니다.
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                await conn.execute(
                    """
                    INSERT INTO ai_document_chunks (
                        document_id,
                        chunk_index,
                        chunk_text,
                        embedding
                    )
                    VALUES ($1::uuid, $2, $3, $4::vector);
                    """,
                    document_id,
                    index,
                    chunk,
                    to_pgvector(embedding),
                )

            return {
                "status": status,
                "documentId": document_id,
                "chunkCount": len(chunks),
            }
    finally:
        # 저장이 끝났으면 DB 연결을 닫습니다.
        await conn.close()
