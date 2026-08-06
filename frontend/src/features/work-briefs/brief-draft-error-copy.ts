type RequestError = {
  status?: unknown;
  code?: unknown;
};

/**
 * A 409 can mean either that the issue is already occupied or that an
 * integration request failed. Keep those paths separate so users are not sent
 * to OAuth settings when another user's invisible draft is the real cause.
 */
export function createDraftFailureMessage(error: RequestError): string {
  if (error.status === 409 && error.code === "DRAFT_ALREADY_EXISTS") {
    return "이 이슈에는 이미 브리프 초안이 있습니다. 다른 사용자가 만든 것일 수 있습니다.";
  }

  return "브리프를 생성하지 못했습니다. 연결 상태와 선택한 근거의 접근 권한을 확인하세요.";
}
