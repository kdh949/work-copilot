import datetime
import hashlib
import os
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

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


class DocumentRequest(BaseModel):
    sourceId: str
    title: str
    content: str
    department: str = '공통'
    tags: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    question: str
    department: str | None = None
    userDepartment: str | None = None


class OnboardingRequest(BaseModel):
    department: str
    employeeName: str | None = None


class JsonRpcRequest(BaseModel):
    jsonrpc: str = '2.0'
    method: str
    params: dict[str, Any] = Field(default_factory=dict)
    id: int | str | None = None


@app.on_event("startup")
def startup() -> None:
    prepare_database()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "database": "on" if can_use_database() else "fallback",
    }


@app.post("/documents")
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


@app.delete("/documents/{source_id}")
def delete_document(source_id: str) -> dict[str, bool]:
    if can_use_database():
        try:
            with psycopg.connect(get_database_url()) as connection:
                connection.execute(
                    "DELETE FROM wiki_documents WHERE source_id = %s",
                    (source_id,),
                )
        except Exception:
            delete_document_from_memory(source_id)
    else:
        delete_document_from_memory(source_id)

    return {
        "deleted": True,
    }


@app.post("/chat")
def chat(request: ChatRequest) -> dict[str, Any]:
    department_filter = choose_department_filter(request.question, request.userDepartment or request.department)
    documents = search_documents_for_intent(request.question, department_filter)
    answer = make_answer(
        "회사 위키 내용을 바탕으로 질문에 답변해주세요.",
        request.question,
        documents,
        department_filter,
    )

    return {
        "answer": answer,
        "searchMode": "department" if department_filter else "all",
        "department": department_filter,
        "sources": make_sources(documents),
    }


@app.post("/onboarding")
def onboarding(request: OnboardingRequest) -> dict[str, Any]:
    employee_name = request.employeeName or '신입 직원'
    question = f"{request.department} 부서에 새로 온 {employee_name}이 입사 직후 해야 할 일을 추천해주세요."
    documents = search_documents(question, request.department)
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


@app.post("/lecture")
def lecture(request: OnboardingRequest) -> dict[str, Any]:
    question = f"{request.department} 부서 신입 직원 교육 강의안을 만들어주세요."
    documents = search_documents(question, request.department)
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


@app.post("/mcp")
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


@app.post("/agent/run")
def run_agent(request: ChatRequest) -> dict[str, Any]:
    state = {
        "question": request.question,
        "department": request.department or '공통',
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
            "department": request.department,
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
            "department": request.department,
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
        request.department,
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
    except Exception:
        print('Postgres 연결 실패: 메모리 저장소로 동작합니다.')


def save_document_to_database(document: DocumentRequest) -> None:
    text = make_document_text(document)
    embedding = make_vector_text(make_embedding(text))

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


def search_documents(question: str, department: str | None) -> list[dict[str, Any]]:
    if can_use_database():
        try:
            return search_documents_from_database(question, department)
        except Exception:
            return search_documents_from_memory(question, department)

    return search_documents_from_memory(question, department)


def search_documents_for_intent(question: str, department: str | None) -> list[dict[str, Any]]:
    documents = search_documents(question, department)

    if department and len(documents) < 5:
        existing_source_ids = {document["sourceId"] for document in documents}
        fallback_documents_for_question = search_documents(question, None)

        for document in fallback_documents_for_question:
            if document["sourceId"] not in existing_source_ids:
                documents.append(document)
                existing_source_ids.add(document["sourceId"])

            if len(documents) >= 5:
                break

    return documents[:5]


def search_documents_from_database(question: str, department: str | None) -> list[dict[str, Any]]:
    embedding = make_vector_text(make_embedding(question))
    department_value = department or ''

    with psycopg.connect(get_database_url()) as connection:
        rows = connection.execute(
            """
            SELECT source_id, title, content, department, tags
            FROM wiki_documents
            WHERE (%s = '' OR department = %s OR department = '공통')
            ORDER BY embedding <-> %s::vector
            LIMIT 5
            """,
            (department_value, department_value, embedding),
        ).fetchall()

    return rows_to_documents(rows)


def search_documents_from_memory(question: str, department: str | None) -> list[dict[str, Any]]:
    words = question.lower().split()
    results: list[dict[str, Any]] = []

    for document in fallback_documents:
        if department and document["department"] not in [department, '공통']:
            continue

        text = f"{document['title']} {document['content']} {' '.join(document['tags'])}".lower()

        if not words or any(word in text for word in words):
            results.append(document)

    return results[:5]


def make_answer(role: str, question: str, documents: list[dict[str, Any]], department: str | None) -> str:
    if os.getenv('OPENAI_API_KEY') and ChatOpenAI and SystemMessage and HumanMessage:
        llm = ChatOpenAI(
            model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
            temperature=0.2,
        )
        response = llm.invoke([
            SystemMessage(content=f"{role} 모르면 모른다고 답하고, 참고한 문서 제목을 함께 언급하세요."),
            HumanMessage(content=f"부서: {department or '공통'}\n질문: {question}\n\n문서:\n{make_context(documents)}"),
        ])
        return str(response.content)

    if not documents:
        return '아직 참고할 회사 위키 문서가 없습니다. 게시글을 먼저 작성하면 더 정확히 답변할 수 있습니다.'

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

    return "\n".join(lines)


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
    documents = search_documents(question, department)

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
