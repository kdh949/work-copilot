import re
from datetime import datetime, timezone

from langchain_core.tools import tool

from app.services.embedding_service import get_embedding
from app.services.github_mcp_service import analyze_github_repository
from app.services.llm_service import generate_answer, generate_general_answer
from app.services.vector_store import search_similar_chunks


def classify_question(question: str, repository_url: str | None = None) -> str:
    # 질문을 보고 어떤 도구를 쓸지 고릅니다.
    # MVP에서는 LLM에게 판단을 맡기기보다, 규칙으로 안전하게 나눕니다.
    normalized = f"{question} {repository_url or ''}".lower()

    if repository_url or "github.com" in normalized or "github" in normalized or "repo" in normalized:
        return "GITHUB_REPO"

    if (
        "크래프톤" in normalized
        or "정글" in normalized
        or "jungle" in normalized
        or "알고리즘" in normalized
        or "학습" in normalized
        or "입학" in normalized
        or "지원" in normalized
        or "후기" in normalized
    ):
        return "JUNGLE_KNOWLEDGE"

    return "GENERAL"


def extract_github_url(text: str) -> str | None:
    # 질문 안에 GitHub repo URL이 있으면 꺼냅니다.
    # 예: "https://github.com/facebook/react 설명해줘" -> 해당 URL만 추출
    match = re.search(r"https?://github\.com/[^\s/]+/[^\s/]+", text)
    if not match:
        return None

    return match.group(0).rstrip(".,)")


@tool
async def rag_search_tool(question: str, limit: int = 5) -> list[dict]:
    """질문과 비슷한 블로그, 게시판, GitHub chunk를 vector DB에서 검색한다."""
    # LangChain Tool로 감싼 RAG 검색 함수입니다.
    # Agent는 이 도구를 사용해서 vector DB에서 근거 자료를 찾습니다.
    question_embedding = await get_embedding(question)
    return await search_similar_chunks(question_embedding, limit)


@tool
async def github_mcp_tool(repository_url: str) -> dict:
    """GitHub repository URL을 분석해서 README, 설명, 파일 힌트를 반환한다."""
    # 참조 프로젝트의 GITHUB_MCP_TOOL 역할입니다.
    # 실제 MCP stdio 대신 GitHub REST API adapter를 LangChain Tool처럼 감쌉니다.
    return await analyze_github_repository(repository_url)


@tool
async def general_llm_tool(question: str) -> str:
    """RAG나 GitHub 분석이 필요 없는 일반 질문에 답한다."""
    # 일반 질문은 vector DB 검색 없이 LLM에게 바로 답변을 맡깁니다.
    return await generate_general_answer(question)


async def agent_ask(
    question: str,
    limit: int = 5,
    repository_url: str | None = None,
) -> dict:
    # 이 함수가 AI Agent의 입구입니다.
    # 질문을 분류하고, 필요한 LangChain Tool을 호출한 뒤, 최종 답변을 만듭니다.
    route = classify_question(question, repository_url)
    state: dict = {
        "route": route,
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    used_tools: list[str] = []
    references: list | dict | str = []

    if route == "GITHUB_REPO":
        used_tools.append("GITHUB_MCP_TOOL")
        target_url = repository_url or extract_github_url(question) or question
        analysis = await github_mcp_tool.ainvoke({"repository_url": target_url})
        references = [analysis]
        state["githubFallback"] = bool(analysis.get("fallback"))
        answer = await generate_answer(
            question,
            [
                {
                    "title": f"GitHub repository: {analysis.get('owner')}/{analysis.get('repo')}",
                    "sourceUrl": analysis.get("repositoryUrl"),
                    "chunkText": "\n".join(
                        [
                            analysis.get("summary", ""),
                            analysis.get("readmePreview", ""),
                            f"Files: {', '.join(analysis.get('fileHints') or [])}",
                        ]
                    ),
                }
            ],
        )
    elif route == "JUNGLE_KNOWLEDGE":
        used_tools.append("RAG_SEARCH_TOOL")
        results = await rag_search_tool.ainvoke({"question": question, "limit": limit})
        references = results
        state["rag"] = {
            "resultCount": len(results),
            "topScore": results[0]["score"] if results else None,
        }
        answer = await generate_answer(question, results)
    else:
        used_tools.append("GENERAL_LLM_TOOL")
        answer = await general_llm_tool.ainvoke({"question": question})

    state["finishedAt"] = datetime.now(timezone.utc).isoformat()

    return {
        "question": question,
        "answer": answer,
        "agentRoute": route,
        "usedTools": used_tools,
        "agentState": state,
        "references": references,
    }
