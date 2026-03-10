# OpenClaw 세션 메모리 & Compaction 가이드

이 문서는 OpenClaw가 **대화 내용을 세션으로 보유**하고, 길어질 때 **compaction(압축 정리)**하는 방식을 이해하기 쉽게 설명합니다.

---

## 1) 세션 메모리란?

OpenClaw에서 세션 메모리는 크게 두 축으로 이해하면 됩니다.

1. **단기 세션 메모리 (대화 히스토리)**
   - 현재 세션에서 오간 사용자/어시스턴트/툴 메시지
   - 실행 컨텍스트, 최근 결정사항, 작업 상태

2. **장기 메모리 (파일 기반)**
   - `MEMORY.md`, `memory/*.md` 같은 파일
   - 세션이 바뀌어도 유지되는 기록

즉, 단기는 “지금 대화의 흐름”, 장기는 “누적된 기억”입니다.

---

## 2) 왜 compaction이 필요한가?

대화가 길어질수록 히스토리가 커지고 다음 문제가 생깁니다.

- 컨텍스트 토큰 증가(비용/지연 증가)
- 중요한 정보가 긴 히스토리 속에 묻힘
- 모델 응답 일관성 저하 가능

`compaction`은 과거를 통째로 버리는 게 아니라,
**핵심 정보(결정/상태/제약/할 일)**를 요약해 유지하고
불필요한 중복을 줄이는 과정입니다.

---

## 3) 세션 보유/압축 흐름 (개념도)

```text
사용자 메시지
  ↓
세션 히스토리 누적 (user/assistant/tool)
  ↓
임계치(길이/토큰/정책) 도달
  ↓
compaction 실행
  - 핵심 결정사항 추출
  - 진행 중 상태 유지
  - 중복/잡음 축소
  ↓
압축된 요약 + 최근 메시지 유지
  ↓
다음 턴에서 더 효율적으로 사용
```

---

## 4) 예시 데이터 (압축 전/후)

> 아래는 설명용 샘플 포맷입니다.

### 4-1) 압축 전 (Before)

```json
{
  "sessionKey": "agent:main:telegram:direct:8488209868",
  "historyCount": 42,
  "messages": [
    {"role": "user", "text": "내일 6:30 미국 뉴스 브리핑 예약해줘"},
    {"role": "assistant", "text": "예약 작업 생성 완료"},
    {"role": "tool", "name": "cron.add", "result": "jobId=..."},
    {"role": "user", "text": "GitHub Pages 메뉴 구조 바꿔줘"},
    {"role": "assistant", "text": "사이드바 수정 후 배포 완료"},
    {"role": "tool", "name": "git.push", "result": "commit=7a0e669"},
    {"role": "user", "text": "배터리 잔량 알려줘"},
    {"role": "assistant", "text": "86%"}
  ]
}
```

### 4-2) 압축 후 (After)

```json
{
  "sessionKey": "agent:main:telegram:direct:8488209868",
  "compacted": true,
  "summary": {
    "decisions": [
      "매일 06:30 미국 뉴스 브리핑 cron 유지",
      "GitHub Pages 사이드바를 주제형 구조로 정리"
    ],
    "artifacts": [
      "repo: leoleosong8888-create/openclaw-book",
      "recentCommit: 7a0e669"
    ],
    "preferences": [
      "불필요한 주기 알림은 최소화",
      "요약은 한국어 간결형 선호"
    ],
    "openTasks": [
      "다음 문서 요청 시 openClaw 메뉴 하위 반영"
    ]
  },
  "recentMessages": [
    {"role": "user", "text": "배터리 잔량 알려줘"},
    {"role": "assistant", "text": "86%"}
  ]
}
```

핵심 포인트:
- 과거 상세 로그는 줄이되,
- **결정사항/진행상태/사용자 선호**는 유지됩니다.

---

## 5) 운영 팁

1. 장기 기억은 파일로 남겨라
- 중요한 건 `MEMORY.md`, `memory/YYYY-MM-DD.md`에 기록

2. compaction 이후 품질 점검
- 압축 후에도 해야 할 일/정책이 유지되는지 확인

3. 세션과 메모리 역할 분리
- 세션: 현재 작업 컨텍스트
- 메모리 파일: 지속적 지식/선호 저장

4. 도구 로그는 결과 중심으로 관리
- 전체 로그보다 `무엇을 결정했고 무엇이 바뀌었는지`를 남기면 유리

---

## 6) 한 줄 결론

OpenClaw의 compaction은 단순 삭제가 아니라,
**긴 대화를 운영 가능한 상태로 유지하기 위한 메모리 최적화 전략**입니다.
