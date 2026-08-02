import argparse
import json
import os
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

try:
    import psycopg
except Exception:
    psycopg = None

try:
    from langchain_openai import OpenAIEmbeddings
except Exception:
    OpenAIEmbeddings = None


EXPECTED_SCHEMA_VERSION = "company-wiki-jsonl-v1"
EXPECTED_DOCUMENT_COUNT = 1000
DEFAULT_BATCH_SIZE = 50
SYNTHETIC_AUTHOR = {
    "email": "wiki-seed@work-copilot.local",
    "password": "imported-wiki-dataset",
    "nickname": "위키 데이터",
    "employeeNumber": "wiki-seed",
    "role": "admin",
}
REQUIRED_FIELDS = {
    "body",
    "created_at",
    "department",
    "doc_type",
    "id",
    "parent_id",
    "path",
    "quality_status",
    "summary",
    "tags",
    "title",
    "updated_at",
}


@dataclass
class WikiDocument:
    source_id: str
    title: str
    content: str
    department: str
    wiki_path: list[str]
    parent_source_id: str | None
    depth: int
    doc_type: str
    summary: str
    tags: list[str]
    quality_status: str
    created_at: str
    updated_at: str


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Import generated company wiki JSONL data into board and vector tables.")
    parser.add_argument("--zip", dest="zip_path", default=os.getenv("WIKI_DATASET_ZIP"), help="Path to wiki dataset zip.")
    parser.add_argument(
        "--database-url",
        default=os.getenv("WIKI_IMPORT_DATABASE_URL") or os.getenv("DATABASE_URL"),
        help="Postgres connection URL. Prefer Render external URL for production imports.",
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Embedding/upsert batch size.")
    parser.add_argument("--dry-run", action="store_true", help="Validate the zip and print a summary without touching DB.")
    parser.add_argument("--rollback", action="store_true", help="Delete imported rows identified by source IDs in the zip.")
    parser.add_argument(
        "--allow-fake-embeddings",
        action="store_true",
        help="Allow deterministic local embeddings when OPENAI_API_KEY is not set. Use only for local tests.",
    )
    args = parser.parse_args()

    if not args.zip_path:
        fail("WIKI_DATASET_ZIP or --zip is required.")

    zip_path = Path(args.zip_path).expanduser()
    documents = load_documents(zip_path)
    print_summary(documents, dry_run=args.dry_run)

    if args.dry_run:
        return 0

    if psycopg is None:
        fail("psycopg is required. Install ai-service requirements first.")

    if not args.database_url:
        fail("WIKI_IMPORT_DATABASE_URL, DATABASE_URL, or --database-url is required.")

    if args.rollback:
        rollback(args.database_url, documents)
        return 0

    embedding_provider = make_embedding_provider(args.allow_fake_embeddings)
    import_documents(args.database_url, documents, embedding_provider, args.batch_size)
    return 0


def load_documents(zip_path: Path) -> list[WikiDocument]:
    if not zip_path.exists():
        fail(f"Dataset zip not found: {zip_path}")

    with zipfile.ZipFile(zip_path) as archive:
        manifest = read_json(archive, "manifest.json")
        schema_version = manifest.get("schema_version")
        if schema_version != EXPECTED_SCHEMA_VERSION:
            fail(f"Unexpected schema_version: {schema_version!r}")

        jsonl_files = [department["file"] for department in manifest.get("departments", [])]
        if not jsonl_files:
            fail("manifest.json does not list department files.")

        documents: list[WikiDocument] = []
        seen_ids: set[str] = set()

        for file_name in jsonl_files:
            try:
                lines = archive.read(file_name).decode("utf-8").splitlines()
            except KeyError:
                fail(f"Missing JSONL file from manifest: {file_name}")

            for line_number, line in enumerate(lines, start=1):
                if not line.strip():
                    continue

                try:
                    raw = json.loads(line)
                except json.JSONDecodeError as error:
                    fail(f"Invalid JSON at {file_name}:{line_number}: {error}")

                missing_fields = REQUIRED_FIELDS - raw.keys()
                if missing_fields:
                    fail(f"{file_name}:{line_number} is missing fields: {sorted(missing_fields)}")

                source_id = clean_required(raw["id"], "id", file_name, line_number)
                if source_id in seen_ids:
                    fail(f"Duplicate document id: {source_id}")
                seen_ids.add(source_id)

                tags = normalize_tags(raw.get("tags"), raw.get("doc_type"), raw.get("quality_status"))
                title = clean_required(raw["title"], "title", file_name, line_number)
                content = clean_required(raw["body"], "body", file_name, line_number)
                wiki_path = normalize_wiki_path(raw.get("path"), title, raw.get("department"))
                documents.append(
                    WikiDocument(
                        source_id=source_id,
                        title=title,
                        content=content,
                        department=clean_required(raw["department"], "department", file_name, line_number),
                        wiki_path=wiki_path,
                        parent_source_id=normalize_optional(raw.get("parent_id")),
                        depth=normalize_depth(raw.get("depth"), file_name, line_number),
                        doc_type=clean_required(raw["doc_type"], "doc_type", file_name, line_number),
                        summary=normalize_optional(raw.get("summary")) or make_summary(content),
                        tags=tags,
                        quality_status=clean_required(raw["quality_status"], "quality_status", file_name, line_number),
                        created_at=clean_required(raw["created_at"], "created_at", file_name, line_number),
                        updated_at=clean_required(raw["updated_at"], "updated_at", file_name, line_number),
                    )
                )

    if len(documents) != EXPECTED_DOCUMENT_COUNT:
        fail(f"Expected {EXPECTED_DOCUMENT_COUNT} documents, found {len(documents)}.")

    return documents


def read_json(archive: zipfile.ZipFile, file_name: str) -> dict[str, Any]:
    try:
        return json.loads(archive.read(file_name).decode("utf-8"))
    except KeyError:
        fail(f"Missing {file_name}.")
    except json.JSONDecodeError as error:
        fail(f"Invalid {file_name}: {error}")


def clean_required(value: Any, field: str, file_name: str, line_number: int) -> str:
    if value is None:
        fail(f"{file_name}:{line_number} field {field} is null.")

    text = str(value).strip()
    if not text:
        fail(f"{file_name}:{line_number} field {field} is blank.")

    return text


def normalize_optional(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def normalize_depth(value: Any, file_name: str, line_number: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        fail(f"{file_name}:{line_number} field depth is not an integer.")


def normalize_wiki_path(raw_path: Any, title: str, department: Any) -> list[str]:
    if isinstance(raw_path, list):
        path = [str(segment).strip() for segment in raw_path if str(segment).strip()]
    else:
        path = []

    if path and path[-1] == title:
        path = path[:-1]

    if path:
        return path

    department_text = str(department or "공통").strip() or "공통"
    return [department_text]


def make_summary(content: str) -> str:
    return " ".join(content.split())[:220]


def normalize_tags(raw_tags: Any, doc_type: Any, quality_status: Any) -> list[str]:
    tags: list[str] = []

    if isinstance(raw_tags, list):
        tags.extend(str(tag).strip() for tag in raw_tags)

    if doc_type:
        tags.append(str(doc_type).strip())

    if quality_status == "needs_review":
        tags.append("검수필요")

    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        if tag and tag not in seen:
            seen.add(tag)
            normalized.append(tag)

    return normalized


def print_summary(documents: list[WikiDocument], dry_run: bool) -> None:
    department_counts: dict[str, int] = {}
    quality_counts: dict[str, int] = {}
    needs_review_count = 0

    for document in documents:
        department_counts[document.department] = department_counts.get(document.department, 0) + 1
        quality_counts[document.quality_status] = quality_counts.get(document.quality_status, 0) + 1
        if "검수필요" in document.tags:
            needs_review_count += 1

    mode = "dry-run" if dry_run else "ready"
    print(f"mode={mode}")
    print(f"documents={len(documents)}")
    print(f"departments={json.dumps(department_counts, ensure_ascii=False, sort_keys=True)}")
    print(f"quality={json.dumps(quality_counts, ensure_ascii=False, sort_keys=True)}")
    print(f"needs_review_tagged={needs_review_count}")


class EmbeddingProvider:
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_documents(self, documents: list[WikiDocument]) -> list[list[float]]:
        return self.embed_texts([make_document_text(document) for document in documents])


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self) -> None:
        if OpenAIEmbeddings is None:
            fail("langchain_openai is required for OpenAI embeddings.")

        self.embeddings = OpenAIEmbeddings(
            model=os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        )

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return self.embeddings.embed_documents(texts)


class FakeEmbeddingProvider(EmbeddingProvider):
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        import hashlib

        vectors: list[list[float]] = []
        for text in texts:
            values: list[float] = []
            for index in range(1536):
                digest = hashlib.sha256(f"{text}-{index}".encode()).hexdigest()
                values.append(int(digest[:2], 16) / 255)
            vectors.append(values)
        return vectors


def make_embedding_provider(allow_fake_embeddings: bool) -> EmbeddingProvider:
    if os.getenv("OPENAI_API_KEY"):
        return OpenAIEmbeddingProvider()

    if allow_fake_embeddings:
        print("OPENAI_API_KEY is not set; using deterministic fake embeddings for local testing.")
        return FakeEmbeddingProvider()

    fail("OPENAI_API_KEY is required for import. Use --allow-fake-embeddings only for local tests.")


def import_documents(database_url: str, documents: list[WikiDocument], embedding_provider: EmbeddingProvider, batch_size: int) -> None:
    if batch_size < 1:
        fail("--batch-size must be greater than 0.")

    with psycopg.connect(database_url) as connection:
        prepare_database(connection)
        author_id = ensure_author(connection)
        connection.commit()

        imported = 0
        for batch in chunks(documents, batch_size):
            embeddings = embedding_provider.embed_documents(batch)
            if len(embeddings) != len(batch):
                fail("Embedding provider returned an unexpected number of vectors.")

            chunk_specs = [
                (document, chunk_index, chunk)
                for document in batch
                for chunk_index, chunk in enumerate(chunk_document_text(document.content))
            ]
            chunk_embeddings = embedding_provider.embed_texts([
                f"{document.title}\n{chunk}" for document, _, chunk in chunk_specs
            ])

            if len(chunk_embeddings) != len(chunk_specs):
                fail("Chunk embedding provider returned an unexpected number of vectors.")

            chunks_by_source: dict[str, list[tuple[int, str, list[float]]]] = {}
            for (document, chunk_index, chunk), chunk_embedding in zip(chunk_specs, chunk_embeddings):
                chunks_by_source.setdefault(document.source_id, []).append((chunk_index, chunk, chunk_embedding))

            with connection.transaction():
                for document, embedding in zip(batch, embeddings):
                    upsert_document(connection, author_id, document, embedding, chunks_by_source.get(document.source_id, []))

            imported += len(batch)
            print(f"imported={imported}/{len(documents)}")

    print("import_complete=true")


def prepare_database(connection: Any) -> None:
    connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS wiki_documents (
            id SERIAL PRIMARY KEY,
            source_id VARCHAR(100) UNIQUE NOT NULL,
            title VARCHAR(200) NOT NULL,
            content TEXT NOT NULL,
            department VARCHAR(100) NOT NULL,
            tags TEXT,
            embedding vector(1536),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS wiki_document_chunks (
            id SERIAL PRIMARY KEY,
            source_id VARCHAR(100) NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding vector(1536),
            UNIQUE (source_id, chunk_index)
        )
        """
    )
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "sourceId" character varying')
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "wikiPath" jsonb')
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "parentSourceId" character varying')
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "depth" integer DEFAULT 0')
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "docType" character varying')
    connection.execute('ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "summary" text')
    connection.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS department character varying')
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_post_source_id_unique"
        ON "post" ("sourceId")
        WHERE "sourceId" IS NOT NULL
        """
    )
    connection.execute('CREATE INDEX IF NOT EXISTS "IDX_post_board_type" ON "post" ("boardType")')
    connection.execute('CREATE INDEX IF NOT EXISTS "IDX_post_department" ON "post" ("department")')
    connection.execute('CREATE INDEX IF NOT EXISTS "IDX_post_wiki_path" ON "post" USING gin ("wikiPath")')
    connection.execute('CREATE INDEX IF NOT EXISTS "IDX_wiki_documents_department" ON wiki_documents (department)')
    connection.execute('CREATE INDEX IF NOT EXISTS "IDX_wiki_document_chunks_source_id" ON wiki_document_chunks (source_id)')
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS "IDX_wiki_documents_embedding"
        ON wiki_documents
        USING ivfflat (embedding vector_l2_ops)
        WITH (lists = 100)
        """
    )


def ensure_author(connection: Any) -> int:
    row = connection.execute(
        'SELECT id FROM users WHERE email = %s',
        (SYNTHETIC_AUTHOR["email"],),
    ).fetchone()
    if row:
        return int(row[0])

    row = connection.execute(
        """
        INSERT INTO users (email, password, nickname, department, "employeeNumber", role, "createdAt", "updatedAt")
        VALUES (%s, %s, %s, '공통', %s, %s, NOW(), NOW())
        ON CONFLICT (email)
        DO UPDATE SET
            nickname = EXCLUDED.nickname,
            department = COALESCE(users.department, EXCLUDED.department),
            role = EXCLUDED.role,
            "updatedAt" = NOW()
        RETURNING id
        """,
        (
            SYNTHETIC_AUTHOR["email"],
            SYNTHETIC_AUTHOR["password"],
            SYNTHETIC_AUTHOR["nickname"],
            SYNTHETIC_AUTHOR["employeeNumber"],
            SYNTHETIC_AUTHOR["role"],
        ),
    ).fetchone()

    if not row:
        fail("Could not create or find synthetic author.")

    return int(row[0])


def upsert_document(
    connection: Any,
    author_id: int,
    document: WikiDocument,
    embedding: list[float],
    document_chunks: list[tuple[int, str, list[float]]],
) -> None:
    tags_value = ",".join(document.tags)
    vector_value = make_vector_text(embedding)

    connection.execute(
        """
        INSERT INTO "post" (
            "sourceId", "wikiPath", "parentSourceId", depth, "docType", summary,
            title, content, "boardType", department, tags, "authorId", "createdAt", "updatedAt"
        )
        VALUES (%s, %s::jsonb, %s, %s, %s, %s, %s, %s, 'wiki', %s, %s, %s, %s::timestamp, %s::timestamp)
        ON CONFLICT ("sourceId") WHERE "sourceId" IS NOT NULL
        DO UPDATE SET
            "wikiPath" = EXCLUDED."wikiPath",
            "parentSourceId" = EXCLUDED."parentSourceId",
            depth = EXCLUDED.depth,
            "docType" = EXCLUDED."docType",
            summary = EXCLUDED.summary,
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            "boardType" = EXCLUDED."boardType",
            department = EXCLUDED.department,
            tags = EXCLUDED.tags,
            "authorId" = EXCLUDED."authorId",
            "createdAt" = EXCLUDED."createdAt",
            "updatedAt" = EXCLUDED."updatedAt"
        """,
        (
            document.source_id,
            json.dumps(document.wiki_path, ensure_ascii=False),
            document.parent_source_id,
            document.depth,
            document.doc_type,
            document.summary,
            document.title,
            document.content,
            document.department,
            tags_value,
            author_id,
            document.created_at,
            document.updated_at,
        ),
    )
    connection.execute("DELETE FROM wiki_document_chunks WHERE source_id = %s", (document.source_id,))
    for chunk_index, chunk, chunk_embedding in document_chunks:
        connection.execute(
            """
            INSERT INTO wiki_document_chunks (source_id, chunk_index, content, embedding)
            VALUES (%s, %s, %s, %s::vector)
            """,
            (document.source_id, chunk_index, chunk, make_vector_text(chunk_embedding)),
        )
    connection.execute(
        """
        INSERT INTO wiki_documents (source_id, title, content, department, tags, embedding, created_at)
        VALUES (%s, %s, %s, %s, %s, %s::vector, %s::timestamp)
        ON CONFLICT (source_id)
        DO UPDATE SET
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            department = EXCLUDED.department,
            tags = EXCLUDED.tags,
            embedding = EXCLUDED.embedding
        """,
        (
            document.source_id,
            document.title,
            document.content,
            document.department,
            tags_value,
            vector_value,
            document.created_at,
        ),
    )


def rollback(database_url: str, documents: list[WikiDocument]) -> None:
    source_ids = [document.source_id for document in documents]

    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            chunk_deleted = connection.execute(
                "DELETE FROM wiki_document_chunks WHERE source_id = ANY(%s)",
                (source_ids,),
            ).rowcount
            wiki_deleted = connection.execute(
                "DELETE FROM wiki_documents WHERE source_id = ANY(%s)",
                (source_ids,),
            ).rowcount
            post_deleted = connection.execute(
                'DELETE FROM "post" WHERE "sourceId" = ANY(%s)',
                (source_ids,),
            ).rowcount

    print(f"rollback_complete=true posts_deleted={post_deleted} wiki_documents_deleted={wiki_deleted} chunks_deleted={chunk_deleted}")


def chunks(values: list[WikiDocument], size: int) -> list[list[WikiDocument]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def make_document_text(document: WikiDocument) -> str:
    return f"{document.title}\n{document.department}\n{','.join(document.tags)}\n{document.content}"


def chunk_document_text(text: str, chunk_size: int = 220, overlap: int = 40) -> list[str]:
    words = text.split()
    if not words:
        return []

    safe_chunk_size = max(1, chunk_size)
    safe_overlap = min(max(0, overlap), safe_chunk_size - 1)
    step = safe_chunk_size - safe_overlap
    values: list[str] = []

    for start in range(0, len(words), step):
        chunk = " ".join(words[start:start + safe_chunk_size])
        if chunk:
            values.append(chunk)
        if start + safe_chunk_size >= len(words):
            break

    return values


def make_vector_text(values: list[float]) -> str:
    if len(values) != 1536:
        fail(f"Expected 1536-dimension embedding, received {len(values)}.")

    return "[" + ",".join(str(value) for value in values) + "]"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    raise SystemExit(main())
