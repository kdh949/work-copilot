import base64
from urllib.parse import urlparse

import httpx

from app.core.config import settings


def parse_github_repo_url(url: str) -> tuple[str, str] | None:
    # GitHub repo 주소인지 확인하고 owner/repo를 뽑습니다.
    # 예: https://github.com/facebook/react -> ("facebook", "react")
    parsed = urlparse(url)

    if parsed.netloc.lower() != "github.com":
        return None

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        return None

    owner = parts[0]
    repo = parts[1].replace(".git", "")
    return owner, repo


def github_headers() -> dict[str, str]:
    # GitHub API에 보낼 기본 header입니다.
    # token이 있으면 Authorization을 붙이고, 없으면 공개 API로 요청합니다.
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "JG-Mentor-AI-Indexer",
    }

    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    return headers


def mock_github_analysis(
    repository_url: str,
    reason: str,
    owner: str | None = None,
    repo: str | None = None,
) -> dict:
    # GitHub API가 실패해도 Agent 전체가 죽지 않게 하는 fallback 응답입니다.
    return {
        "mode": "mock",
        "repositoryUrl": repository_url,
        "owner": owner,
        "repo": repo,
        "summary": reason,
        "readmePreview": (
            "Mock README: 이 저장소는 README, 루트 파일, 기술 스택을 기준으로 "
            "구조를 분석하는 데모 응답입니다."
        ),
        "fileHints": ["dir:src", "file:README.md", "file:package.json"],
        "fallback": True,
    }


async def analyze_github_repository(repository_url: str) -> dict:
    # 참조 프로젝트의 GitHub MCP adapter와 같은 역할입니다.
    # 실제 MCP stdio 연결 대신 GitHub REST API를 tool처럼 사용합니다.
    parsed = parse_github_repo_url(repository_url)
    if not parsed:
        return mock_github_analysis(
            repository_url,
            "GitHub repository URL을 파싱할 수 없어 fallback 분석을 반환했습니다.",
        )

    owner, repo = parsed
    headers = github_headers()

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            repo_response = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}",
                headers=headers,
            )
            readme_response = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/readme",
                headers=headers,
            )
            contents_response = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/contents",
                headers=headers,
            )

        if repo_response.status_code != 200:
            return mock_github_analysis(
                repository_url,
                f"GitHub API 응답 실패({repo_response.status_code})로 fallback했습니다.",
                owner,
                repo,
            )

        repo_data = repo_response.json()
        readme_text = ""

        if readme_response.status_code == 200:
            readme_data = readme_response.json()
            encoded = readme_data.get("content", "")
            if encoded:
                readme_text = base64.b64decode(encoded).decode("utf-8", errors="replace")

        file_hints = []
        if contents_response.status_code == 200:
            contents_data = contents_response.json()
            if isinstance(contents_data, list):
                file_hints = [
                    f"{item.get('type', 'file')}:{item.get('name', '')}"
                    for item in contents_data[:20]
                ]

        summary = " / ".join(
            [
                repo_data.get("description") or "설명 없음",
                f"주요 언어: {repo_data.get('language') or '정보 없음'}",
                f"Stars: {repo_data.get('stargazers_count', 0)}",
            ]
        )

        return {
            "mode": "github_api",
            "repositoryUrl": repository_url,
            "owner": owner,
            "repo": repo,
            "summary": summary,
            "readmePreview": readme_text[:1200],
            "fileHints": file_hints,
            "fallback": False,
        }
    except Exception:
        return mock_github_analysis(
            repository_url,
            "GitHub API 호출 중 오류가 발생해 fallback했습니다.",
            owner,
            repo,
        )


async def fetch_github_repository_text(repository_url: str) -> str:
    # GitHub repo를 vector DB에 넣기 위한 긴 텍스트로 바꿉니다.
    # Agent 분석 결과와 README를 합쳐서 RAG 검색 가능한 문서로 만듭니다.
    analysis = await analyze_github_repository(repository_url)

    return "\n\n".join(
        [
            f"{analysis.get('owner')}/{analysis.get('repo')}",
            f"Repository URL: {analysis.get('repositoryUrl')}",
            f"Summary: {analysis.get('summary')}",
            f"Files: {', '.join(analysis.get('fileHints') or []) or '파일 목록 없음'}",
            "README:",
            analysis.get("readmePreview") or "README를 찾지 못했습니다.",
        ]
    )
