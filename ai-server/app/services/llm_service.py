from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from app.core.config import settings


def build_context_text(results: list[dict]) -> str:
    # vector DB에서 찾은 chunk들을 LLM이 읽기 쉬운 글로 합칩니다.
    # LLM에게는 "이 자료들을 보고 답해줘"라고 넘길 예정입니다.
    lines = []

    for index, result in enumerate(results, start=1):
        source_url = result.get("sourceUrl") or "출처 URL 없음"
        title = result.get("title") or "제목 없음"
        chunk_text = result.get("chunkText") or ""

        lines.append(
            f"[자료 {index}]\n"
            f"제목: {title}\n"
            f"출처: {source_url}\n"
            f"내용:\n{chunk_text}"
        )

    return "\n\n".join(lines)


async def generate_general_answer(question: str) -> str:
    # RAG 자료 없이 일반 질문에 답하는 함수입니다.
    # Agent가 "검색보다 일반 답변이 맞다"고 판단했을 때 사용합니다.
    if not settings.openai_api_key:
        return f'"{question}"에 대한 일반 mock 답변입니다. OPENAI_API_KEY를 설정하면 실제 LLM 답변이 생성됩니다.'

    try:
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "너는 크래프톤 정글 학습자를 돕는 한국어 AI 멘토야. 짧고 정확하게 답해.",
                ),
                ("human", "{question}"),
            ]
        )
        llm = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0.2,
        )
        chain = prompt | llm
        message = await chain.ainvoke({"question": question})
        return str(message.content)
    except Exception:
        return f'"{question}"에 대한 일반 mock 답변입니다. LLM 호출에 실패했습니다.'


async def generate_answer(question: str, results: list[dict]) -> str:
    # 사용자의 질문과 vector DB에서 찾은 자료를 함께 LLM에게 보냅니다.
    # 이게 RAG의 핵심입니다: LLM이 자기 기억만 쓰지 않고, 우리가 찾은 자료를 같이 봅니다.
    if not settings.openai_api_key:
        return mock_answer(question, results)

    context_text = build_context_text(results)

    try:
        # LangChain의 ChatPromptTemplate은 LLM에게 보낼 메시지 틀입니다.
        # system에는 AI의 역할을, human에는 실제 질문과 참고 자료를 넣습니다.
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "너는 크래프톤 정글 학습자를 돕는 한국어 AI 멘토야. "
                        "반드시 제공된 자료를 우선 근거로 사용하고, "
                        "근거가 부족하면 부족하다고 말해."
                    ),
                ),
                (
                    "human",
                    "질문:\n{question}\n\n참고 자료:\n{context}",
                ),
            ]
        )

        # ChatOpenAI는 LangChain이 제공하는 OpenAI 채팅 모델 래퍼입니다.
        # 직접 HTTP 요청을 만들지 않고 invoke/ainvoke로 모델을 호출할 수 있습니다.
        llm = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0.2,
        )

        # prompt | llm 은 LangChain의 LCEL 문법입니다.
        # "프롬프트를 만든 다음 LLM에 넣어라"라는 뜻입니다.
        chain = prompt | llm
        message = await chain.ainvoke(
            {
                "question": question,
                "context": context_text or "검색된 자료 없음",
            }
        )

        return str(message.content)
    except Exception:
        # API 오류가 나도 서버가 죽지 않도록 테스트용 답변을 돌려줍니다.
        return mock_answer(question, results)


def mock_answer(question: str, results: list[dict]) -> str:
    # OpenAI key가 없을 때 사용하는 테스트용 답변입니다.
    # 진짜 LLM 답변은 아니지만, RAG 흐름이 연결됐는지 확인하기 좋습니다.
    if not results:
        return (
            f'"{question}"에 대한 관련 자료를 아직 찾지 못했습니다.\n'
            "먼저 블로그나 GitHub URL을 /index-url로 인덱싱해 주세요."
        )

    top = results[0]
    title = top.get("title") or "제목 없음"
    chunk_text = (top.get("chunkText") or "")[:300]

    return (
        f'"{question}"에 대해 vector DB에서 가장 가까운 자료를 찾았습니다.\n\n'
        f"가장 관련 있는 자료: {title}\n"
        f"근거 일부:\n{chunk_text}\n\n"
        "OPENAI_API_KEY가 없거나 LLM 호출에 실패해서 mock 답변을 반환했습니다."
    )
