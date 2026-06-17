import re
from datetime import datetime, timezone

from langchain_core.tools import tool

from app.services.embedding_service import get_embedding
from app.services.github_mcp_service import (
    analyze_github_repository,
    search_github_repositories,
)
from app.services.guardrail_service import (
    validate_model_output,
    validate_user_input,
)
from app.services.llm_service import generate_answer, generate_general_answer
from app.services.vector_store import search_keyword_chunks, search_similar_chunks


EXHIBITION_HINTS = ("프로젝트", "전시회", "나만무", "서비스", "플랫폼")


def classify_question(question: str, repository_url: str | None = None) -> str:
    # 질문을 보고 어떤 도구를 쓸지 고릅니다.
    # MVP에서는 LLM에게 판단을 맡기기보다, 규칙으로 안전하게 나눕니다.
    normalized = f"{question} {repository_url or ''}".lower()

    if (
        repository_url
        or "github.com" in normalized
        or "github" in normalized
        or "깃허브" in normalized
        or "repo" in normalized
        or "repository" in normalized
        or "저장소" in normalized
    ):
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


def extract_keyword_candidates(question: str) -> list[str]:
    # 질문에서 exact 검색에 쓸 만한 고유명사 후보를 뽑습니다.
    # 예: "CloszIT 프로젝트 설명해줘" -> ["CloszIT"]
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_.-]{2,}", question)
    keep: list[str] = []

    for candidate in candidates:
        normalized = candidate.lower()
        if normalized in {"github", "repo", "rag", "api", "url"}:
            continue
        if candidate not in keep:
            keep.append(candidate)

    return keep


def is_exhibition_question(question: str) -> bool:
    # 프로젝트 전시회/나만무 질문이면 공식 전시회 자료를 먼저 찾게 합니다.
    return any(hint in question for hint in EXHIBITION_HINTS)


def merge_rag_results(primary: list[dict], secondary: list[dict], limit: int) -> list[dict]:
    # exact 검색 결과를 앞에 두고, 부족한 만큼 vector 검색 결과를 뒤에 붙입니다.
    # 같은 문서가 여러 chunk로 반복되면 참고 근거가 지저분해지므로 documentId 기준으로 중복 제거합니다.
    merged: list[dict] = []
    seen: set[str] = set()

    for result in [*primary, *secondary]:
        unique_id = result.get("documentId") or result.get("chunkId")
        if unique_id in seen:
            continue

        if unique_id:
            seen.add(unique_id)
        merged.append(result)

        if len(merged) >= limit:
            break

    return merged


@tool
async def rag_search_tool(question: str, limit: int = 5) -> list[dict]:
    """질문과 비슷한 블로그, 게시판, GitHub chunk를 vector DB에서 검색한다."""
    # LangChain Tool로 감싼 RAG 검색 함수입니다.
    # Agent는 이 도구를 사용해서 vector DB에서 근거 자료를 찾습니다.
    question_embedding = await get_embedding(question)
    return await search_similar_chunks(question_embedding, limit)


@tool
async def keyword_rag_search_tool(
    keyword: str,
    limit: int = 3,
    source_type: str | None = None,
) -> list[dict]:
    """정확한 프로젝트명이나 키워드가 들어간 chunk를 문자열 검색으로 찾는다."""
    # CloszIT, Moduly처럼 이름이 정확히 들어간 질문은 vector보다 문자열 검색이 강합니다.
    return await search_keyword_chunks(keyword, limit, source_type)


@tool
async def github_mcp_tool(repository_url: str) -> dict:
    """GitHub repository URL을 분석해서 README, 설명, 파일 힌트를 반환한다."""
    # 참조 프로젝트의 GITHUB_MCP_TOOL 역할입니다.
    # 실제 MCP stdio 대신 GitHub REST API adapter를 LangChain Tool처럼 감쌉니다.
    return await analyze_github_repository(repository_url)


@tool
async def github_search_tool(query: str, limit: int = 5) -> list[dict]:
    """GitHub repository를 키워드로 검색한다."""
    # 질문에 GitHub URL이 없을 때 쓰는 도구입니다.
    # GitHub 검색 결과 중 가장 관련 있어 보이는 repository를 고를 수 있게 합니다.
    return await search_github_repositories(query, limit)


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
    input_check_text = "\n".join(
        value for value in [question, repository_url or ""] if value
    )
    input_check = await validate_user_input(input_check_text)

    if not input_check.allowed:
        return {
            "question": question,
            "answer": input_check.message,
            "agentRoute": "BLOCKED",
            "usedTools": ["INPUT_GUARDRAIL"],
            "agentState": {
                "guardrailReason": input_check.reason,
                "guardrailCategories": input_check.categories,
                "finishedAt": datetime.now(timezone.utc).isoformat(),
            },
            "references": [],
        }

    route = classify_question(question, repository_url)
    state: dict = {
        "route": route,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "inputGuardrail": {
            "reason": input_check.reason,
            "categories": input_check.categories,
        },
    }
    used_tools: list[str] = []
    references: list | dict | str = []

    if route == "GITHUB_REPO":
        target_url = repository_url or extract_github_url(question)
        search_results: list[dict] = []

        if not target_url:
            # 질문에 URL이 없으면 GitHub 검색을 먼저 실행합니다.
            # 예: "깃허브에서 krafton jungle 찾아줘" -> 관련 repo 검색
            used_tools.append("GITHUB_SEARCH_TOOL")
            search_results = await github_search_tool.ainvoke(
                {"query": question, "limit": limit}
            )
            target_url = (
                search_results[0].get("repositoryUrl") if search_results else question
            )

        used_tools.append("GITHUB_MCP_TOOL")
        analysis = await github_mcp_tool.ainvoke({"repository_url": target_url})
        references = [analysis, *search_results]
        state["githubFallback"] = bool(analysis.get("fallback"))
        state["githubSearch"] = {
            "resultCount": len(search_results),
            "selectedRepositoryUrl": target_url,
        }
        file_context = "\n\n".join(
            [
                f"[{file.get('path')}]\n{file.get('textPreview')}"
                for file in analysis.get("fileContents", [])
            ]
        )
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
                            # GitHub 주요 파일 내용을 답변 재료에 추가합니다.
                            # 너무 긴 파일은 github_mcp_service에서 앞부분만 잘라서 들어옵니다.
                            f"Selected files: {', '.join(analysis.get('selectedFiles') or [])}",
                            "Selected file previews:",
                            file_context,
                        ]
                    ),
                }
            ],
        )
    elif route == "JUNGLE_KNOWLEDGE":
        exact_results: list[dict] = []
        keyword_candidates = extract_keyword_candidates(question)
        source_type = "OFFICIAL_EXHIBITION" if is_exhibition_question(question) else None

        for keyword in keyword_candidates:
            # 프로젝트명 후보가 있으면 exact 검색을 먼저 실행합니다.
            # 전시회 질문이면 OFFICIAL_EXHIBITION 자료를 우선 보게 합니다.
            found = await keyword_rag_search_tool.ainvoke(
                {
                    "keyword": keyword,
                    "limit": 3,
                    "source_type": source_type,
                }
            )
            if found:
                exact_results.extend(found)

        if exact_results:
            used_tools.append("KEYWORD_RAG_SEARCH_TOOL")

        used_tools.append("RAG_SEARCH_TOOL")
        vector_results = await rag_search_tool.ainvoke(
            {"question": question, "limit": limit}
        )
        results = merge_rag_results(exact_results, vector_results, limit)
        references = results
        state["rag"] = {
            "resultCount": len(results),
            "keywordResultCount": len(exact_results),
            "keywordCandidates": keyword_candidates,
            "sourceTypeHint": source_type,
            "topScore": results[0]["score"] if results else None,
        }
        answer = await generate_answer(question, results)
    else:
        used_tools.append("GENERAL_LLM_TOOL")
        answer = await general_llm_tool.ainvoke({"question": question})

    output_check = await validate_model_output(answer)
    if not output_check.allowed:
        answer = output_check.message
        used_tools.append("OUTPUT_GUARDRAIL")

    state["outputGuardrail"] = {
        "reason": output_check.reason,
        "categories": output_check.categories,
    }
    state["finishedAt"] = datetime.now(timezone.utc).isoformat()

    return {
        "question": question,
        "answer": answer,
        "agentRoute": route,
        "usedTools": used_tools,
        "agentState": state,
        "references": references,
    }
