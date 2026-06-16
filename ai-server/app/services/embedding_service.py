import hashlib
import math

from langchain_openai import OpenAIEmbeddings

from app.core.config import settings

# text-embedding-3-small 모델은 보통 1536개의 숫자로 된 벡터를 만듭니다.
# 그래서 mock embedding도 같은 길이로 맞춥니다.
EMBEDDING_DIMENSION = 1536


async def get_embedding(text: str) -> list[float]:
    # embedding은 글을 컴퓨터가 비교할 수 있는 숫자 목록으로 바꾸는 일입니다.
    # 예: "알고리즘 공부" -> [0.01, -0.02, 0.33, ...]

    # OpenAI key가 없으면 진짜 API를 부를 수 없으니 테스트용 embedding을 만듭니다.
    if not settings.openai_api_key:
        return mock_embedding(text)

    try:
        # LangChain의 OpenAIEmbeddings가 OpenAI embedding API 호출을 대신 처리합니다.
        # 직접 HTTP 요청을 만들지 않아도 모델명, API key, 응답 파싱을 맡길 수 있습니다.
        embeddings = OpenAIEmbeddings(
            model=settings.openai_embedding_model,
            api_key=settings.openai_api_key,
        )
        return await embeddings.aembed_query(text)
    except Exception:
        # 개발 중에는 API 오류 때문에 전체 서버가 죽지 않게 mock으로 대신합니다.
        return mock_embedding(text)


async def preview_embedding(text: str) -> dict:
    # embedding 전체는 1536개 숫자라서 화면에 다 보여주면 너무 깁니다.
    # 그래서 앞의 숫자 몇 개만 잘라서 "잘 만들어졌는지" 확인합니다.
    embedding = await get_embedding(text)

    return {
        "textLength": len(text),
        "model": settings.openai_embedding_model,
        "dimension": len(embedding),
        "isMock": not bool(settings.openai_api_key),
        "sample": embedding[:8],
    }


def mock_embedding(text: str) -> list[float]:
    # 이 함수는 진짜 AI embedding은 아닙니다.
    # 대신 같은 단어가 있으면 비슷한 숫자 벡터가 나오게 만드는 테스트용 함수입니다.
    vector = [0.0] * EMBEDDING_DIMENSION

    # 글을 빈칸 기준으로 단어처럼 나눕니다.
    tokens = [
        token
        for token in text.lower().replace("\n", " ").split(" ")
        if token.strip()
    ]

    # 글이 비어 있으면 원본 text라도 하나의 토큰으로 사용합니다.
    if not tokens:
        tokens = [text]

    for token in tokens:
        # 단어를 hash로 바꿔서 항상 같은 단어는 같은 위치에 영향을 주게 합니다.
        digest = hashlib.sha256(token.encode("utf-8")).digest()

        for i, value in enumerate(digest):
            index = (value + i * 31) % EMBEDDING_DIMENSION
            vector[index] += 1.0

    # 벡터의 길이를 1에 가깝게 맞춥니다.
    # 그래야 나중에 벡터끼리 비교할 때 값이 너무 커지지 않습니다.
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0

    return [round(value / norm, 6) for value in vector]
