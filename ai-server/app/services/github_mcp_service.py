import base64
import re
from urllib.parse import urlparse

import httpx

from app.core.config import settings


MAX_GITHUB_FILES_TO_SCAN = 80
MAX_GITHUB_FILES_TO_READ = 8
MAX_GITHUB_FILE_CHARS = 3000

IMPORTANT_FILE_NAMES = {
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "poetry.lock",
    "pom.xml",
    "build.gradle",
    "dockerfile",
    "docker-compose.yml",
    "main.py",
    "app.py",
    "server.py",
    "index.js",
    "server.js",
    "main.ts",
    "app.module.ts",
}

IMPORTANT_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
    ".toml",
}

SKIP_DIRS = {
    ".git",
    ".github",
    ".next",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "venv",
}


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


def is_safe_github_file(path: str) -> bool:
    # GitHub 파일을 읽기 전에 위험한 파일인지 먼저 확인합니다.
    # .env처럼 비밀키가 들어갈 수 있는 파일은 Agent가 읽지 않게 막습니다.
    lowered = path.lower()
    file_name = lowered.rsplit("/", 1)[-1]

    if file_name == ".env" or file_name.startswith(".env."):
        return file_name == ".env.example"

    return not any(secret_word in lowered for secret_word in ["secret", "private", "credential"])


def should_scan_github_dir(path: str, depth: int) -> bool:
    # 모든 폴더를 다 읽으면 너무 오래 걸립니다.
    # 그래서 코드가 있을 가능성이 높은 폴더만 골라서 들어갑니다.
    if depth <= 0:
        return True

    first_part = path.split("/", 1)[0].lower()
    return first_part in {
        "ai-server",
        "app",
        "backend",
        "client",
        "frontend",
        "server",
        "src",
    }


def github_file_priority(path: str) -> tuple[int, int, str]:
    # 중요한 파일이 먼저 뽑히도록 점수를 줍니다.
    # package.json, requirements.txt 같은 파일은 프로젝트 성격을 빨리 알려줍니다.
    lowered = path.lower()
    file_name = lowered.rsplit("/", 1)[-1]

    if file_name == "readme.md":
        return (0, len(path), path)
    if file_name in IMPORTANT_FILE_NAMES:
        return (1, len(path), path)
    if file_name.startswith(("main.", "app.", "server.", "index.")):
        return (2, len(path), path)
    if "/src/" in f"/{lowered}" or lowered.startswith("src/"):
        return (3, len(path), path)
    return (4, len(path), path)


def should_pick_github_file(path: str) -> bool:
    # Agent 답변에 넣을 만한 파일인지 고릅니다.
    # 의존성 파일, main 파일, src 안의 코드 파일을 우선 사용합니다.
    lowered = path.lower()
    file_name = lowered.rsplit("/", 1)[-1]
    extension = "." + file_name.rsplit(".", 1)[-1] if "." in file_name else ""

    if not is_safe_github_file(path):
        return False

    if file_name == "readme.md":
        return False

    return (
        file_name in IMPORTANT_FILE_NAMES
        or file_name.startswith(("main.", "app.", "server.", "index."))
        or (extension in IMPORTANT_EXTENSIONS and ("/src/" in f"/{lowered}" or lowered.startswith("src/")))
    )


async def list_github_files(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    path: str = "",
    depth: int = 0,
) -> list[dict]:
    # GitHub 저장소의 파일 목록을 가져옵니다.
    # 루트부터 보고, src 같은 주요 폴더만 조금 더 깊게 들어갑니다.
    if depth > 3:
        return []

    response = await client.get(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=github_headers(),
    )
    if response.status_code != 200:
        return []

    data = response.json()
    if not isinstance(data, list):
        return []

    files: list[dict] = []

    for item in data:
        item_type = item.get("type")
        item_path = item.get("path", "")
        item_name = item.get("name", "")

        if item_type == "file":
            files.append(
                {
                    "path": item_path,
                    "name": item_name,
                    "size": item.get("size", 0),
                    "downloadUrl": item.get("download_url"),
                }
            )
        elif (
            item_type == "dir"
            and item_name.lower() not in SKIP_DIRS
            and should_scan_github_dir(item_path, depth)
            and len(files) < MAX_GITHUB_FILES_TO_SCAN
        ):
            files.extend(
                await list_github_files(
                    client,
                    owner,
                    repo,
                    item_path,
                    depth + 1,
                )
            )

        if len(files) >= MAX_GITHUB_FILES_TO_SCAN:
            break

    return files[:MAX_GITHUB_FILES_TO_SCAN]


async def fetch_github_file_content(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    path: str,
) -> dict | None:
    # 선택된 파일 하나의 내용을 가져옵니다.
    # 파일이 너무 길면 앞부분만 잘라서 Agent에게 넘깁니다.
    if not is_safe_github_file(path):
        return None

    response = await client.get(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=github_headers(),
    )
    if response.status_code != 200:
        return None

    data = response.json()
    encoded = data.get("content", "")
    if not encoded:
        return None

    text = base64.b64decode(encoded).decode("utf-8", errors="replace")

    return {
        "path": path,
        "size": data.get("size", len(text)),
        "textPreview": text[:MAX_GITHUB_FILE_CHARS],
        "truncated": len(text) > MAX_GITHUB_FILE_CHARS,
    }


def select_github_files(files: list[dict]) -> list[dict]:
    # 가져온 파일 목록 중 답변에 도움이 되는 파일만 고릅니다.
    # 정렬 점수가 낮을수록 더 중요한 파일입니다.
    selected = [file for file in files if should_pick_github_file(file.get("path", ""))]
    selected.sort(key=lambda file: github_file_priority(file.get("path", "")))
    return selected[:MAX_GITHUB_FILES_TO_READ]


def make_github_search_query(question: str) -> str:
    # 질문 문장에서 GitHub 검색에 방해되는 말을 빼고 핵심 검색어만 남깁니다.
    # 예: "깃허브에서 krafton jungle 검색해줘" -> "krafton jungle"
    cleaned = re.sub(r"https?://github\.com/\S+", " ", question, flags=re.IGNORECASE)
    english_terms = re.findall(r"[A-Za-z0-9_.-]+", cleaned)
    korean_terms = re.findall(r"[가-힣]+", cleaned)

    stop_words = {
        "깃허브",
        "저장소",
        "검색",
        "검색해줘",
        "찾아",
        "찾아줘",
        "분석",
        "분석해줘",
        "해줘",
        "에서",
        "관련",
        "어떤",
        "프로젝트",
        "프로젝트인지",
        "설명",
        "설명해줘",
    }

    query_terms = [term for term in english_terms if term.lower() not in {"github", "repo", "repository"}]

    # 한국어 핵심어는 GitHub 검색에서 잘 잡히도록 영어 검색어도 함께 넣습니다.
    # 예: "크래프톤 정글" -> "krafton jungle"
    if "크래프톤" in korean_terms and "krafton" not in [term.lower() for term in query_terms]:
        query_terms.append("krafton")
    if "정글" in korean_terms and "jungle" not in [term.lower() for term in query_terms]:
        query_terms.append("jungle")

    if english_terms:
        return " ".join(query_terms) or question

    for term in korean_terms:
        if (
            term not in stop_words
            and term not in {"크래프톤", "정글"}
            and not any(stop_word in term for stop_word in stop_words)
        ):
            query_terms.append(term)

    return " ".join(query_terms) or question


def mock_github_analysis(
    repository_url: str,
    reason: str,
    owner: str | None = None,
    repo: str | None = None,
) -> dict:
    # GitHub API가 실패해도 Agent 전체가 죽지 않게 하는 fallback 응답입니다.
    return {
        "mode": "mock",
        "title": f"GitHub repository: {owner or 'unknown'}/{repo or 'unknown'}",
        "sourceUrl": repository_url,
        "repositoryUrl": repository_url,
        "owner": owner,
        "repo": repo,
        "summary": reason,
        "readmePreview": (
            "Mock README: 이 저장소는 README, 루트 파일, 기술 스택을 기준으로 "
            "구조를 분석하는 데모 응답입니다."
        ),
        "fileHints": ["dir:src", "file:README.md", "file:package.json"],
        "selectedFiles": [],
        "fileContents": [],
        "fallback": True,
    }


async def search_github_repositories(query: str, limit: int = 5) -> list[dict]:
    # GitHub 홈페이지 검색창처럼 repository를 찾는 함수입니다.
    # 실제 화면을 여는 대신 GitHub Search API를 MCP 도구처럼 사용합니다.
    search_query = make_github_search_query(query)

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            response = await client.get(
                "https://api.github.com/search/repositories",
                params={
                    "q": search_query,
                    "sort": "stars",
                    "order": "desc",
                    "per_page": limit,
                },
                headers=github_headers(),
            )

        if response.status_code != 200:
            return []

        data = response.json()
        repositories = []

        for item in data.get("items", []):
            repositories.append(
                {
                    "title": item.get("full_name"),
                    "sourceUrl": item.get("html_url"),
                    "name": item.get("name"),
                    "fullName": item.get("full_name"),
                    "repositoryUrl": item.get("html_url"),
                    "description": item.get("description") or "설명 없음",
                    "language": item.get("language") or "정보 없음",
                    "stars": item.get("stargazers_count", 0),
                }
            )

        return repositories
    except Exception:
        # 검색 실패 때문에 Agent 전체가 멈추지 않게 빈 목록을 반환합니다.
        return []


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
            discovered_files = await list_github_files(client, owner, repo)
            selected_files = select_github_files(discovered_files)
            file_contents = []

            for selected_file in selected_files:
                file_content = await fetch_github_file_content(
                    client,
                    owner,
                    repo,
                    selected_file["path"],
                )
                if file_content:
                    file_contents.append(file_content)

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
            "title": f"GitHub repository: {owner}/{repo}",
            "sourceUrl": repository_url,
            "repositoryUrl": repository_url,
            "owner": owner,
            "repo": repo,
            "summary": summary,
            "readmePreview": readme_text[:1200],
            "fileHints": file_hints,
            "selectedFiles": [file["path"] for file in selected_files],
            "fileContents": file_contents,
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
    file_sections = [
        f"[{file.get('path')}]\n{file.get('textPreview')}"
        for file in analysis.get("fileContents", [])
    ]

    return "\n\n".join(
        [
            f"{analysis.get('owner')}/{analysis.get('repo')}",
            f"Repository URL: {analysis.get('repositoryUrl')}",
            f"Summary: {analysis.get('summary')}",
            f"Files: {', '.join(analysis.get('fileHints') or []) or '파일 목록 없음'}",
            f"Selected files: {', '.join(analysis.get('selectedFiles') or []) or '선택된 파일 없음'}",
            "README:",
            analysis.get("readmePreview") or "README를 찾지 못했습니다.",
            "Selected file previews:",
            "\n\n".join(file_sections) or "선택된 파일 내용을 찾지 못했습니다.",
        ]
    )
