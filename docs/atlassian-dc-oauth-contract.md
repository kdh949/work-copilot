# Atlassian Data Center OAuth2 게시 계약

실제 게시 모드는 mock 테스트만으로 활성화하지 않는다. 지원할 Jira·Confluence Data
Center 조합마다 **사용자 OAuth2 access token**으로 아래 opt-in 계약 테스트를 실행하고,
실행 결과의 제품 버전·상태 코드·응답 shape를 배포 기록에 남긴다.

```bash
cd backend
RUN_ATLASSIAN_DC_OAUTH_CONTRACT_TESTS=true \
ATLASSIAN_CONTRACT_JIRA_BASE_URL=https://jira.staging.example.test \
ATLASSIAN_CONTRACT_CONFLUENCE_BASE_URL=https://confluence.staging.example.test \
ATLASSIAN_CONTRACT_JIRA_TOKEN='user-context-token' \
ATLASSIAN_CONTRACT_CONFLUENCE_TOKEN='user-context-token' \
ATLASSIAN_CONTRACT_CONFLUENCE_PARENT_PAGE_ID=12345 \
ATLASSIAN_CONTRACT_JIRA_ISSUE_ID=10001 \
ATLASSIAN_CONTRACT_JIRA_ISSUE_KEY=ENG-1 \
ATLASSIAN_CONTRACT_JIRA_PROJECT_KEY=ENG \
ATLASSIAN_CONTRACT_JIRA_SUBTASK_ISSUE_TYPE_ID=10001 \
ATLASSIAN_CONTRACT_JIRA_VERSION='Jira Data Center 10.x' \
ATLASSIAN_CONTRACT_CONFLUENCE_VERSION='Confluence Data Center 9.x' \
npm test -- --runInBand src/publications/atlassian-dc-oauth.contract.spec.ts
```

테스트 대상은 전용 staging Space·프로젝트·부모 이슈여야 한다. 테스트는 생성한
Confluence 페이지, Jira remote link·comment·하위 작업을 정리하므로 해당 사용자에게
그 범위의 생성·삭제 권한이 필요하다. production token이나 production 대상은 사용하지
않는다.

검증 범위는 다음과 같다.

- Confluence: 부모 페이지 조회, 페이지 생성·조회, 하위 페이지 pagination
- Jira: remote link 조회·생성, comment 조회·생성, `createmeta`, issue create의 `properties`,
  issue property 조회, JQL search pagination

Confluence content-property API는 계약 대상에서 의도적으로 제외했다. 게시 adapter는 그
endpoint 대신 승인된 `draftId + content hash`에서 만든 결정적 페이지 제목 marker로
reconciliation한다. Jira 하위 작업 marker는 issue-create body의 `properties`에 함께
보내므로 생성 이후 별도 property PUT 창이 없다.

계약이 통과한 정확한 Data Center 버전과 test run URL을 운영 변경 기록에 남긴 뒤에만
다음을 설정한다.

```dotenv
PUBLICATION_WRITE_MODE=real
PUBLICATION_ATLASSIAN_OAUTH_CONTRACT=verified
```

지원 endpoint가 OAuth2 사용자 토큰에서 거부되거나 응답 shape가 다르면 위 설정을 하지
않는다. `mock` 모드를 유지하고, 지원되는 인증·앱 경계 또는 별도 durable reconciliation
전략을 선택한 뒤 계약을 다시 실행한다.
