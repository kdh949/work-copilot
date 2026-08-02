import datetime
import hmac
import hashlib
import os
import time
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from work_brief.service import (
    WorkBriefError,
    WorkBriefGenerateRequest,
    WorkBriefSanitizeRequest,
    generate_work_brief as generate_work_brief_response,
    sanitize_work_brief_values,
)

try:
    import psycopg
except Exception:
    psycopg = None

try:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings
except Exception:
    ChatOpenAI = None
    HumanMessage = None
    OpenAIEmbeddings = None
    SystemMessage = None

load_dotenv()

app = FastAPI(title="DH Board AI Service")

fallback_documents: list[dict[str, Any]] = []
agent_memory: dict[str, list[dict[str, str]]] = {}


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    request: Request,
    error: RequestValidationError,
):
    # Default FastAPI validation errors can echo an invalid request value.  The
    # work-brief route accepts external evidence, so it intentionally exposes
    # only a constant message rather than a pre-DLP source fragment.
    if request.url.path.startswith("/work-brief/"):
        return JSONResponse(
            status_code=422,
            content={"detail": "Work brief request is invalid."},
        )
    return await request_validation_exception_handler(request, error)


class DocumentRequest(BaseModel):
    sourceId: str
    title: str
    content: str
    department: str = '공통'
    tags: list[str] = Field(default_factory=list)


class AccessContext(BaseModel):
    role: str
    department: str


class ChatRequest(BaseModel):
    question: str
    access: AccessContext


class OnboardingRequest(BaseModel):
    department: str
    employeeName: str | None = None
    access: AccessContext


class JsonRpcRequest(BaseModel):
    jsonrpc: str = '2.0'
    method: str
    params: dict[str, Any] = Field(default_factory=dict)
    id: int | str | None = None


def require_internal_api_key(x_ai_service_key: str | None = Header(default=None)) -> None:
    expected_api_key = os.getenv('AI_SERVICE_API_KEY')

    if not expected_api_key:
        raise HTTPException(status_code=503, detail='AI 서비스 내부 인증이 설정되지 않았습니다.')

    if not x_ai_service_key or not hmac.compare_digest(x_ai_service_key, expected_api_key):
        raise HTTPException(status_code=401, detail='AI 서비스 내부 인증에 실패했습니다.')


@app.on_event("startup")
def startup() -> None:
    prepare_database()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "database": "on" if can_use_database() else "fallback",
    }


@app.get("/operations/summary", dependencies=[Depends(require_internal_api_key)])
def operations_summary() -> dict[str, Any]:
    return get_operations_summary()


@app.post("/documents", dependencies=[Depends(require_internal_api_key)])
def save_document(document: DocumentRequest) -> dict[str, str]:
    if can_use_database():
        try:
            save_document_to_database(document)
        except Exception:
            save_document_to_memory(document)
    else:
        save_document_to_memory(document)

    return {
        "message": "문서가 저장되었습니다.",
        "sourceId": document.sourceId,
    }


@app.delete("/documents/{source_id}", dependencies=[Depends(require_internal_api_key)])
def delete_document(source_id: str) -> dict[str, bool]:
    if can_use_database():
        try:
            with psycopg.connect(get_database_url()) as connection:
                connection.execute(
                    "DELETE FROM wiki_documents WHERE source_id = %s",
                    (source_id,),
                )
                connection.execute(
                    "DELETE FROM wiki_document_chunks WHERE source_id = %s",
                    (source_id,),
                )
        except Exception:
            delete_document_from_memory(source_id)
    else:
        delete_document_from_memory(source_id)

    return {
        "deleted": True,
    }


@app.post("/work-brief/generate", dependencies=[Depends(require_internal_api_key)])
def generate_work_brief(request: WorkBriefGenerateRequest) -> dict[str, Any]:
    """Generate from DLP-masked transient evidence without wiki RAG access."""

    try:
        return generate_work_brief_response(request)
    except WorkBriefError as error:
        # The service deliberately discards provider/DLP detail before it reaches
        # this boundary, so response payloads and framework logs stay safe.
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/work-brief/sanitize", dependencies=[Depends(require_internal_api_key)])
def sanitize_work_brief(request: WorkBriefSanitizeRequest) -> dict[str, list[str]]:
    """Mask user-edited brief text before Nest persists it as a draft."""

    try:
        return sanitize_work_brief_values(request)
    except WorkBriefError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/chat", dependencies=[Depends(require_internal_api_key)])
def chat(request: ChatRequest) -> dict[str, Any]:
    started_at = time.perf_counter()
    department_filter = choose_department_filter(request.question, request.access.department)

    try:
        documents = search_documents_for_intent(request.question, department_filter, request.access)

        if should_abstain(documents, get_minimum_confidence()):
            result = {
                "answer": "확인 가능한 회사 위키 근거가 부족해 답변할 수 없습니다. 질문을 구체화하거나 관련 위키 문서를 추가해주세요.",
                "searchMode": "department" if department_filter else "all",
                "department": department_filter,
                "retrievalMode": get_retrieval_mode(),
                "abstained": True,
                "inputTokens": 0,
                "outputTokens": 0,
                "estimatedCost": 0.0,
                "sources": [],
            }
            record_ai_request('chat', 'abstained', 0, int((time.perf_counter() - started_at) * 1000))
            return result

        answer, usage = make_answer_with_usage(
            "회사 위키 내용을 바탕으로 질문에 답변해주세요.",
            request.question,
            documents,
            department_filter,
        )
        result = {
            "answer": answer,
            "searchMode": "department" if department_filter else "all",
            "department": department_filter,
            "retrievalMode": get_retrieval_mode(),
            "abstained": False,
            "inputTokens": usage['inputTokens'],
            "outputTokens": usage['outputTokens'],
            "estimatedCost": estimate_chat_cost(usage),
            "sources": make_sources(documents),
        }
        record_ai_request('chat', 'success', len(documents), int((time.perf_counter() - started_at) * 1000), usage)
        return result
    except Exception as error:
        record_ai_request('chat', 'error', 0, int((time.perf_counter() - started_at) * 1000), error_code=type(error).__name__)
        raise


@app.post("/onboarding", dependencies=[Depends(require_internal_api_key)])
def onboarding(request: OnboardingRequest) -> dict[str, Any]:
    employee_name = request.employeeName or '신입 직원'
    question = f"{request.department} 부서에 새로 온 {employee_name}이 입사 직후 해야 할 일을 추천해주세요."
    documents = search_documents(question, request.department, request.access)
    answer = make_answer(
        "신입 직원 온보딩 체크리스트를 만들어주세요.",
        question,
        documents,
        request.department,
    )

    return {
        "answer": answer,
        "sources": make_sources(documents),
    }


@app.post("/lecture", dependencies=[Depends(require_internal_api_key)])
def lecture(request: OnboardingRequest) -> dict[str, Any]:
    question = f"{request.department} 부서 신입 직원 교육 강의안을 만들어주세요."
    documents = search_documents(question, request.department, request.access)
    answer = make_answer(
        "신입 직원에게 설명할 짧은 강의안을 만들어주세요.",
        question,
        documents,
        request.department,
    )

    return {
        "answer": answer,
        "sources": make_sources(documents),
    }


@app.post("/mcp", dependencies=[Depends(require_internal_api_key)])
def mcp(request: JsonRpcRequest, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    check_mcp_api_key(x_api_key)

    if request.method == 'tools/list':
        return json_rpc_result(request.id, {
            "tools": [
                {
                    "name": "search_wiki",
                    "description": "회사 위키 문서를 검색합니다.",
                },
                {
                    "name": "get_company_holiday",
                    "description": "외부 공휴일 API에서 회사 휴무 참고일을 조회합니다.",
                },
            ],
        })

    if request.method == 'tools/call':
        name = request.params.get('name')
        arguments = request.params.get('arguments', {})

        if name == 'search_wiki':
            result = tool_search_wiki(arguments)
            return json_rpc_result(request.id, result)

        if name == 'get_company_holiday':
            result = tool_get_company_holiday(arguments)
            return json_rpc_result(request.id, result)

        return json_rpc_error(request.id, -32601, '지원하지 않는 도구입니다.')

    return json_rpc_error(request.id, -32601, '지원하지 않는 MCP 메서드입니다.')


@app.post("/agent/run", dependencies=[Depends(require_internal_api_key)])
def run_agent(request: ChatRequest) -> dict[str, Any]:
    state = {
        "question": request.question,
        "department": request.access.department,
        "access": request.access,
        "steps": [],
        "documents": [],
        "holiday": None,
    }

    tool_functions = {
        "search_wiki": tool_search_wiki,
        "get_company_holiday": tool_get_company_holiday,
    }

    # 최대 3회까지만 도구를 호출해서 무한 루프를 막는다.
    for step in range(3):
        tool_name = choose_tool(request.question, step)
        tool_arguments = {
            "question": request.question,
            "department": request.access.department,
            "access": request.access,
        }

        tool_result = tool_functions[tool_name](tool_arguments)
        state["steps"].append({
            "tool": tool_name,
            "result": tool_result,
        })

        if tool_name == 'search_wiki':
            state["documents"] = tool_result.get('documents', [])
            break

        state["holiday"] = tool_result

    if not state["documents"]:
        wiki_result = tool_search_wiki({
            "question": request.question,
            "department": request.access.department,
            "access": request.access,
        })
        state["documents"] = wiki_result.get('documents', [])
        state["steps"].append({
            "tool": "search_wiki",
            "result": wiki_result,
        })

    answer = make_answer(
        "필요한 도구를 선택해 실행한 뒤 최종 답변을 만들어주세요.",
        request.question,
        state["documents"],
        request.access.department,
    )

    save_agent_memory(state["department"], request.question, answer)

    return {
        "answer": answer,
        "steps": state["steps"],
        "memoryCount": len(agent_memory[state["department"]]),
        "sources": make_sources(state["documents"]),
    }


def prepare_database() -> None:
    if not can_use_database():
        return

    try:
        with psycopg.connect(get_database_url()) as connection:
            connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
            connection.execute("""
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
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS wiki_document_chunks (
                    id SERIAL PRIMARY KEY,
                    source_id VARCHAR(100) NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    embedding vector(1536),
                    UNIQUE (source_id, chunk_index)
                )
            """)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_wiki_document_chunks_source_id ON wiki_document_chunks (source_id)",
            )
            connection.execute("""
                CREATE TABLE IF NOT EXISTS ai_request_events (
                    id SERIAL PRIMARY KEY,
                    request_id VARCHAR(64) NOT NULL,
                    route VARCHAR(64) NOT NULL,
                    outcome VARCHAR(32) NOT NULL,
                    retrieval_mode VARCHAR(32) NOT NULL,
                    result_count INTEGER NOT NULL,
                    latency_ms INTEGER NOT NULL,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    estimated_cost NUMERIC(12, 8) NOT NULL DEFAULT 0,
                    error_code VARCHAR(64),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
    except Exception:
        print('Postgres 연결 실패: 메모리 저장소로 동작합니다.')


def save_document_to_database(document: DocumentRequest) -> None:
    text = make_document_text(document)
    embedding = make_vector_text(make_embedding(text))
    chunks = chunk_document_text(document.content)

    with psycopg.connect(get_database_url()) as connection:
        connection.execute(
            """
            INSERT INTO wiki_documents (source_id, title, content, department, tags, embedding)
            VALUES (%s, %s, %s, %s, %s, %s::vector)
            ON CONFLICT (source_id)
            DO UPDATE SET
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                department = EXCLUDED.department,
                tags = EXCLUDED.tags,
                embedding = EXCLUDED.embedding
            """,
            (
                document.sourceId,
                document.title,
                document.content,
                document.department,
                ','.join(document.tags),
                embedding,
            ),
        )
        connection.execute(
            "DELETE FROM wiki_document_chunks WHERE source_id = %s",
            (document.sourceId,),
        )

        for chunk_index, chunk in enumerate(chunks):
            chunk_embedding = make_vector_text(make_embedding(f"{document.title}\n{chunk}"))
            connection.execute(
                """
                INSERT INTO wiki_document_chunks (source_id, chunk_index, content, embedding)
                VALUES (%s, %s, %s, %s::vector)
                """,
                (document.sourceId, chunk_index, chunk, chunk_embedding),
            )


def save_document_to_memory(document: DocumentRequest) -> None:
    delete_document_from_memory(document.sourceId)
    fallback_documents.append({
        "sourceId": document.sourceId,
        "title": document.title,
        "content": document.content,
        "department": document.department,
        "tags": document.tags,
    })


def delete_document_from_memory(source_id: str) -> None:
    for document in list(fallback_documents):
        if document["sourceId"] == source_id:
            fallback_documents.remove(document)


def is_document_visible(access: AccessContext, document_department: str) -> bool:
    return access.role == 'admin' or document_department in ['공통', access.department]


def search_documents(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    if can_use_database():
        try:
            return search_documents_from_database(question, preferred_department, access)
        except Exception:
            return search_documents_from_memory(question, preferred_department, access)

    return search_documents_from_memory(question, preferred_department, access)


def search_documents_for_intent(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    documents = search_documents(question, preferred_department, access)

    if preferred_department and len(documents) < 5:
        existing_source_ids = {document["sourceId"] for document in documents}
        fallback_documents_for_question = search_documents(question, None, access)

        for document in fallback_documents_for_question:
            if document["sourceId"] not in existing_source_ids:
                documents.append(document)
                existing_source_ids.add(document["sourceId"])

            if len(documents) >= 5:
                break

    return documents[:5]


def search_documents_from_database(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    if get_retrieval_mode() == 'document-vector':
        return search_documents_from_database_baseline(question, preferred_department, access)

    try:
        documents = search_documents_from_database_hybrid(question, preferred_department, access)
    except Exception:
        # 배포 직후 청크 백필 전에도 기존 전체 문서 기준선으로 응답을 유지한다.
        return search_documents_from_database_baseline(question, preferred_department, access)

    if documents:
        return documents

    return search_documents_from_database_baseline(question, preferred_department, access)


def search_documents_from_database_baseline(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    embedding = make_vector_text(make_embedding(question))
    department_value = preferred_department or ''

    with psycopg.connect(get_database_url()) as connection:
        rows = connection.execute(
            """
            SELECT documents.source_id, documents.title, documents.content, documents.department, documents.tags,
                   documents.embedding <-> %s::vector AS distance
            FROM wiki_documents AS documents
            JOIN "post" AS post
              ON post."sourceId" = documents.source_id
              OR (post."sourceId" IS NULL AND documents.source_id = CONCAT('post-', post.id))
            WHERE post."boardType" = 'wiki'
              AND (%s OR post.department = '공통' OR post.department = %s)
              AND (%s = '' OR documents.department = %s OR documents.department = '공통')
            ORDER BY distance
            LIMIT 5
            """,
            (embedding, access.role == 'admin', access.department, department_value, department_value),
        ).fetchall()

    documents = rows_to_documents([row[:5] for row in rows])

    for document, row in zip(documents, rows):
        document['confidence'] = distance_to_confidence(float(row[5]))

    return documents


def search_documents_from_database_hybrid(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    embedding = make_vector_text(make_embedding(question))
    department_value = preferred_department or ''

    with psycopg.connect(get_database_url()) as connection:
        vector_rows = connection.execute(
            """
            SELECT chunks.id::text, chunks.source_id, documents.title, chunks.content,
                   documents.department, documents.tags, chunks.embedding <-> %s::vector AS distance
            FROM wiki_document_chunks AS chunks
            JOIN wiki_documents AS documents ON documents.source_id = chunks.source_id
            JOIN "post" AS post
              ON post."sourceId" = documents.source_id
              OR (post."sourceId" IS NULL AND documents.source_id = CONCAT('post-', post.id))
            WHERE post."boardType" = 'wiki'
              AND (%s OR post.department = '공통' OR post.department = %s)
              AND (%s = '' OR documents.department = %s OR documents.department = '공통')
            ORDER BY distance
            LIMIT 20
            """,
            (embedding, access.role == 'admin', access.department, department_value, department_value),
        ).fetchall()
        keyword_rows = search_keyword_chunks(connection, question, department_value, access)

    chunks_by_id: dict[str, dict[str, Any]] = {}

    for row in vector_rows:
        chunks_by_id[row[0]] = make_chunk_result(row, distance_to_confidence(float(row[6])))

    for row in keyword_rows:
        chunks_by_id.setdefault(row[0], make_chunk_result(row, 1.0))

    ranked_chunk_ids = reciprocal_rank_fusion(
        [row[0] for row in vector_rows],
        [row[0] for row in keyword_rows],
    )
    documents: list[dict[str, Any]] = []
    seen_source_ids: set[str] = set()

    for chunk_id in ranked_chunk_ids:
        chunk = chunks_by_id[chunk_id]

        if chunk['sourceId'] in seen_source_ids:
            continue

        documents.append(chunk)
        seen_source_ids.add(chunk['sourceId'])

        if len(documents) >= 5:
            break

    return documents


def search_keyword_chunks(
    connection: Any,
    question: str,
    department_value: str,
    access: AccessContext,
) -> list[tuple[Any, ...]]:
    terms = [word for word in question.split() if len(word) >= 2][:5]

    if not terms:
        return []

    patterns = [f"%{term}%" for term in terms]
    return connection.execute(
        """
        SELECT chunks.id::text, chunks.source_id, documents.title, chunks.content,
               documents.department, documents.tags
        FROM wiki_document_chunks AS chunks
        JOIN wiki_documents AS documents ON documents.source_id = chunks.source_id
        JOIN "post" AS post
          ON post."sourceId" = documents.source_id
          OR (post."sourceId" IS NULL AND documents.source_id = CONCAT('post-', post.id))
        WHERE post."boardType" = 'wiki'
          AND (%s OR post.department = '공통' OR post.department = %s)
          AND (%s = '' OR documents.department = %s OR documents.department = '공통')
          AND chunks.content ILIKE ANY(%s)
        ORDER BY chunks.id
        LIMIT 20
        """,
        (access.role == 'admin', access.department, department_value, department_value, patterns),
    ).fetchall()


def make_chunk_result(row: tuple[Any, ...], confidence: float) -> dict[str, Any]:
    return {
        'chunkId': str(row[0]),
        'sourceId': str(row[1]),
        'title': str(row[2]),
        'content': str(row[3]),
        'department': str(row[4]),
        'tags': str(row[5]).split(',') if row[5] else [],
        'confidence': confidence,
    }


def distance_to_confidence(distance: float) -> float:
    return max(0.0, min(1.0, 1 - distance / 2))


def get_retrieval_mode() -> str:
    return os.getenv('RAG_RETRIEVAL_MODE', 'hybrid-chunks')


def get_minimum_confidence() -> float:
    try:
        return max(0.0, min(1.0, float(os.getenv('RAG_MIN_CONFIDENCE', '0'))))
    except ValueError:
        return 0.0


def search_documents_from_memory(
    question: str,
    preferred_department: str | None,
    access: AccessContext,
) -> list[dict[str, Any]]:
    words = question.lower().split()
    results: list[dict[str, Any]] = []

    for document in fallback_documents:
        if not is_document_visible(access, document["department"]):
            continue

        if preferred_department and document["department"] not in [preferred_department, '공통']:
            continue

        text = f"{document['title']} {document['content']} {' '.join(document['tags'])}".lower()

        if not words or any(word in text for word in words):
            results.append(document)

    return results[:5]


def make_answer(role: str, question: str, documents: list[dict[str, Any]], department: str | None) -> str:
    answer, _ = make_answer_with_usage(role, question, documents, department)
    return answer


def make_answer_with_usage(
    role: str,
    question: str,
    documents: list[dict[str, Any]],
    department: str | None,
) -> tuple[str, dict[str, int]]:
    if os.getenv('OPENAI_API_KEY') and ChatOpenAI and SystemMessage and HumanMessage:
        llm = ChatOpenAI(
            model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
            temperature=0.2,
        )
        response = llm.invoke([
            SystemMessage(content=f"{role} 모르면 모른다고 답하고, 참고한 문서 제목을 함께 언급하세요."),
            HumanMessage(content=f"부서: {department or '공통'}\n질문: {question}\n\n문서:\n{make_context(documents)}"),
        ])
        usage = getattr(response, 'usage_metadata', None)
        if not usage:
            metadata = getattr(response, 'response_metadata', {})
            usage = metadata.get('token_usage', {}) if isinstance(metadata, dict) else {}
        return str(response.content), extract_token_usage(usage)

    if not documents:
        return '아직 참고할 회사 위키 문서가 없습니다. 게시글을 먼저 작성하면 더 정확히 답변할 수 있습니다.', {
            'inputTokens': 0,
            'outputTokens': 0,
        }

    lines = [
        f"{department or '공통'} 기준으로 회사 위키를 확인했습니다.",
        "",
        "추천 내용:",
    ]

    for index, document in enumerate(documents, start=1):
        lines.append(f"{index}. {document['title']} 내용을 먼저 확인하세요.")

    lines.append("")
    lines.append("상세 답변:")
    lines.append(documents[0]["content"][:500])

    return "\n".join(lines), {
        'inputTokens': 0,
        'outputTokens': 0,
    }


def choose_tool(question: str, step: int) -> str:
    if step == 0 and ('휴일' in question or '공휴일' in question or '휴가' in question):
        return 'get_company_holiday'

    return 'search_wiki'


def choose_department_filter(question: str, user_department: str | None) -> str | None:
    if not user_department:
        return None

    normalized_question = question.replace(" ", "").lower()
    department_keywords = [
        "우리부서",
        "부서업무",
        "업무파악",
        "프로젝트",
        "운영기준",
        "로드맵",
        "요구사항",
        "장애",
        "릴리즈",
        "고객대응",
    ]
    common_keywords = [
        "인사",
        "급여",
        "휴가",
        "연차",
        "공휴일",
        "휴일",
        "복지",
        "계정",
        "온보딩",
        "입사",
        "근태",
    ]

    if any(keyword in normalized_question for keyword in department_keywords):
        return user_department

    if any(keyword in normalized_question for keyword in common_keywords):
        return None

    return None


def tool_search_wiki(arguments: dict[str, Any]) -> dict[str, Any]:
    question = str(arguments.get('question', ''))
    department = arguments.get('department')
    raw_access = arguments.get('access')
    access = raw_access if isinstance(raw_access, AccessContext) else AccessContext(
        role=str(raw_access.get('role', 'employee')) if isinstance(raw_access, dict) else 'employee',
        department=str(raw_access.get('department', '공통')) if isinstance(raw_access, dict) else '공통',
    )
    documents = search_documents(question, department, access)

    return {
        "documents": documents,
    }


def tool_get_company_holiday(arguments: dict[str, Any]) -> dict[str, Any]:
    country = arguments.get('country', os.getenv('HOLIDAY_COUNTRY', 'KR'))
    year = arguments.get('year', datetime.date.today().year)
    url = os.getenv('HOLIDAY_API_URL', 'https://date.nager.at/api/v3/PublicHolidays')

    try:
        response = requests.get(f"{url}/{year}/{country}", timeout=5)
        response.raise_for_status()
        holidays = response.json()[:5]
    except Exception:
        holidays = []

    return {
        "country": country,
        "year": year,
        "holidays": holidays,
    }


def save_agent_memory(department: str, question: str, answer: str) -> None:
    if department not in agent_memory:
        agent_memory[department] = []

    agent_memory[department].append({
        "question": question,
        "answer": answer,
    })

    agent_memory[department] = agent_memory[department][-5:]


def make_embedding(text: str) -> list[float]:
    if os.getenv('OPENAI_API_KEY') and OpenAIEmbeddings:
        embeddings = OpenAIEmbeddings(
            model=os.getenv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
        )
        return embeddings.embed_query(text)

    values: list[float] = []

    for index in range(1536):
        digest = hashlib.sha256(f"{text}-{index}".encode()).hexdigest()
        values.append(int(digest[:2], 16) / 255)

    return values


def make_vector_text(values: list[float]) -> str:
    return '[' + ','.join(str(value) for value in values[:1536]) + ']'


def make_document_text(document: DocumentRequest) -> str:
    return f"{document.title}\n{document.department}\n{','.join(document.tags)}\n{document.content}"


def chunk_document_text(text: str, chunk_size: int = 220, overlap: int = 40) -> list[str]:
    words = text.split()

    if not words:
        return []

    safe_chunk_size = max(1, chunk_size)
    safe_overlap = min(max(0, overlap), safe_chunk_size - 1)
    step = safe_chunk_size - safe_overlap
    chunks: list[str] = []

    for start in range(0, len(words), step):
        chunk = " ".join(words[start:start + safe_chunk_size])
        if chunk:
            chunks.append(chunk)
        if start + safe_chunk_size >= len(words):
            break

    return chunks


def reciprocal_rank_fusion(
    vector_ranked_ids: list[str],
    keyword_ranked_ids: list[str],
    rank_constant: int = 60,
) -> list[str]:
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}

    for ranking in [vector_ranked_ids, keyword_ranked_ids]:
        for index, item_id in enumerate(ranking, start=1):
            scores[item_id] = scores.get(item_id, 0.0) + 1 / (rank_constant + index)
            first_seen.setdefault(item_id, len(first_seen))

    return sorted(scores, key=lambda item_id: (-scores[item_id], first_seen[item_id]))


def should_abstain(documents: list[dict[str, Any]], minimum_confidence: float) -> bool:
    if not documents:
        return True

    return max(float(document.get("confidence", 0.0)) for document in documents) < minimum_confidence


def extract_token_usage(usage: Any) -> dict[str, int]:
    values = usage if isinstance(usage, dict) else {}
    input_tokens = values.get('input_tokens', values.get('prompt_tokens', 0))
    output_tokens = values.get('output_tokens', values.get('completion_tokens', 0))

    return {
        'inputTokens': int(input_tokens or 0),
        'outputTokens': int(output_tokens or 0),
    }


def estimate_chat_cost(usage: dict[str, int]) -> float:
    input_price = float(os.getenv('OPENAI_INPUT_COST_PER_1M', '0.15'))
    output_price = float(os.getenv('OPENAI_OUTPUT_COST_PER_1M', '0.60'))

    return round(
        usage['inputTokens'] / 1_000_000 * input_price
        + usage['outputTokens'] / 1_000_000 * output_price,
        8,
    )


def make_context(documents: list[dict[str, Any]]) -> str:
    if not documents:
        return '참고 문서 없음'

    lines: list[str] = []

    for document in documents:
        lines.append(f"제목: {document['title']}")
        lines.append(f"부서: {document['department']}")
        lines.append(f"내용: {document['content']}")
        lines.append("")

    return "\n".join(lines)


def make_sources(documents: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "sourceId": str(document["sourceId"]),
            "title": str(document["title"]),
            "department": str(document["department"]),
        }
        for document in documents
    ]


def rows_to_documents(rows: list[tuple[Any, ...]]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []

    for row in rows:
        tags = row[4].split(',') if row[4] else []
        documents.append({
            "sourceId": row[0],
            "title": row[1],
            "content": row[2],
            "department": row[3],
            "tags": tags,
        })

    return documents


def can_use_database() -> bool:
    return bool(get_database_url()) and psycopg is not None


def get_database_url() -> str:
    return os.getenv('DATABASE_URL', '')


def record_ai_request(
    route: str,
    outcome: str,
    result_count: int,
    latency_ms: int,
    usage: dict[str, int] | None = None,
    error_code: str | None = None,
) -> None:
    if not can_use_database():
        return

    token_usage = usage or {'inputTokens': 0, 'outputTokens': 0}

    try:
        with psycopg.connect(get_database_url()) as connection:
            connection.execute(
                """
                INSERT INTO ai_request_events (
                    request_id, route, outcome, retrieval_mode, result_count, latency_ms,
                    input_tokens, output_tokens, estimated_cost, error_code
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    hashlib.sha256(f"{route}-{time.time_ns()}".encode()).hexdigest()[:32],
                    route,
                    outcome,
                    get_retrieval_mode(),
                    result_count,
                    latency_ms,
                    token_usage['inputTokens'],
                    token_usage['outputTokens'],
                    estimate_chat_cost(token_usage),
                    error_code,
                ),
            )
    except Exception:
        # 관찰성 장애가 사용자 요청을 실패시키면 안 된다.
        return


def get_operations_summary() -> dict[str, Any]:
    if not can_use_database():
        return {'requests': 0, 'errors': 0, 'p50LatencyMs': 0, 'p95LatencyMs': 0, 'estimatedCost': 0.0}

    try:
        with psycopg.connect(get_database_url()) as connection:
            row = connection.execute(
                """
                SELECT COUNT(*),
                       COUNT(*) FILTER (WHERE outcome = 'error'),
                       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0),
                       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0),
                       COALESCE(SUM(estimated_cost), 0)
                FROM ai_request_events
                WHERE created_at >= NOW() - INTERVAL '7 days'
                """,
            ).fetchone()
    except Exception:
        return {'requests': 0, 'errors': 0, 'p50LatencyMs': 0, 'p95LatencyMs': 0, 'estimatedCost': 0.0}

    return {
        'requests': int(row[0]),
        'errors': int(row[1]),
        'p50LatencyMs': int(row[2]),
        'p95LatencyMs': int(row[3]),
        'estimatedCost': float(row[4]),
    }


def check_mcp_api_key(api_key: str | None) -> None:
    expected_api_key = os.getenv('MCP_API_KEY')

    if expected_api_key and api_key != expected_api_key:
        raise HTTPException(status_code=401, detail='MCP API Key가 올바르지 않습니다.')


def json_rpc_result(request_id: int | str | None, result: Any) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": result,
    }


def json_rpc_error(request_id: int | str | None, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }
