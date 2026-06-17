BEGIN;

INSERT INTO tags (name) VALUES
  ('학습'),
  ('github'),
  ('자료공유')
ON CONFLICT (name) DO NOTHING;

WITH target_titles AS (
  SELECT unnest(ARRAY[
    '정글 주차별 학습 기록을 어떻게 정리하면 좋을까요?',
    '알고리즘 오답노트 템플릿 공유합니다',
    'GitHub Actions로 백엔드 테스트 자동화해본 후기',
    '자료공유: CS 면접 대비에 도움 된 링크 모음'
  ]) AS title
)
DELETE FROM board
WHERE title IN (SELECT title FROM target_titles);

WITH new_boards AS (
  INSERT INTO board (title, content, writer, "viewCount") VALUES
    (
      '정글 주차별 학습 기록을 어떻게 정리하면 좋을까요?',
      '매주 배운 내용이 많아서 블로그에 정리하려고 하는데, 막상 쓰려니 너무 길어집니다.

지금은 과제 목표, 막힌 지점, 해결 과정, 다음에 다시 볼 키워드 정도로 나누려고 합니다. 나중에 면접이나 프로젝트 회고에도 쓸 수 있게 정리하는 방식이 있을까요?',
      'hajin',
      34
    ),
    (
      '알고리즘 오답노트 템플릿 공유합니다',
      '요즘 문제를 많이 풀어도 비슷한 실수를 반복해서 오답노트 형식을 바꿔봤습니다.

- 문제 유형
- 처음 떠올린 접근
- 틀린 이유
- 정답 접근의 핵심 아이디어
- 다시 풀 날짜

특히 "틀린 이유"를 문장으로 쓰니까 구현 실수인지, 자료구조 선택 문제인지 구분하기 좋았습니다.',
      'seungho',
      57
    ),
    (
      'GitHub Actions로 백엔드 테스트 자동화해본 후기',
      'PR 올릴 때마다 로컬에서 테스트를 깜빡해서 GitHub Actions를 붙여봤습니다.

Node 버전 고정, npm ci 사용, 테스트용 env 설정 세 가지를 맞추니 NestJS 테스트가 안정적으로 돌았습니다. 팀 프로젝트에서는 최소한 lint와 test만 자동으로 돌아도 리뷰 부담이 많이 줄어드는 것 같습니다.',
      'minji',
      61
    ),
    (
      '자료공유: CS 면접 대비에 도움 된 링크 모음',
      'CS 스터디 준비하면서 괜찮았던 자료를 모아봤습니다.

- 운영체제: 프로세스/스레드, 가상 메모리, 동기화
- 네트워크: TCP 흐름 제어, 혼잡 제어, HTTP 캐시
- 데이터베이스: 인덱스, 트랜잭션 격리 수준, 정규화

링크 자체보다 각 주제를 3분 안에 말로 설명해보는 연습이 제일 도움이 됐습니다.',
      'dabin',
      72
    )
  RETURNING id, title
),
tag_links AS (
  SELECT nb.id AS board_id, t.id AS tag_id
  FROM new_boards nb
  JOIN tags t ON
    (nb.title = '정글 주차별 학습 기록을 어떻게 정리하면 좋을까요?' AND t.name IN ('질문', '학습', '정글생활'))
    OR (nb.title = '알고리즘 오답노트 템플릿 공유합니다' AND t.name IN ('자료공유', '알고리즘', '학습'))
    OR (nb.title = 'GitHub Actions로 백엔드 테스트 자동화해본 후기' AND t.name IN ('정보공유', 'github', '백엔드'))
    OR (nb.title = '자료공유: CS 면접 대비에 도움 된 링크 모음' AND t.name IN ('자료공유', 'CS', '취업'))
)
INSERT INTO board_tags (board_id, tag_id)
SELECT board_id, tag_id FROM tag_links;

INSERT INTO comment ("boardId", content, writer)
SELECT b.id, c.content, c.writer
FROM board b
JOIN (
  VALUES
    ('정글 주차별 학습 기록을 어떻게 정리하면 좋을까요?', '저는 "오늘 이해한 것"과 "아직 찝찝한 것"을 분리해서 적었더니 나중에 다시 보기 좋았습니다.', 'yeseul'),
    ('정글 주차별 학습 기록을 어떻게 정리하면 좋을까요?', '면접 대비까지 생각하면 해결 과정에 왜 그 선택을 했는지도 한 줄씩 남기는 걸 추천합니다.', 'junseo'),
    ('알고리즘 오답노트 템플릿 공유합니다', '다시 풀 날짜를 적는 게 좋네요. 저는 일주일 뒤에 다시 풀면 같은 실수를 꽤 잘 잡았습니다.', 'areum'),
    ('알고리즘 오답노트 템플릿 공유합니다', '틀린 이유를 "구현", "아이디어", "시간복잡도"로 태깅해두면 약점이 빨리 보입니다.', 'taemin'),
    ('GitHub Actions로 백엔드 테스트 자동화해본 후기', 'npm ci로 고정하는 부분 중요합니다. package-lock 기준이라 로컬이랑 CI 차이가 줄어들더라고요.', 'soobin'),
    ('GitHub Actions로 백엔드 테스트 자동화해본 후기', 'DB가 필요한 테스트는 서비스 컨테이너까지 붙이면 좋은데, 처음에는 unit test만 돌려도 충분한 것 같습니다.', 'hyeri'),
    ('자료공유: CS 면접 대비에 도움 된 링크 모음', '3분 설명 연습 공감합니다. 알고 있다고 생각한 개념도 말로 하면 빈틈이 바로 드러나요.', 'kiwoong'),
    ('자료공유: CS 면접 대비에 도움 된 링크 모음', '트랜잭션 격리 수준은 예시 상황이랑 같이 외우면 훨씬 오래 갔습니다.', 'nayeon')
) AS c(title, content, writer) ON c.title = b.title;

COMMIT;
