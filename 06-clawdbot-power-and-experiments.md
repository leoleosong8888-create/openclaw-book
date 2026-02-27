# 6) Clawdbot/OpenClaw Deep Dive

아래는 요청한 5가지 주제를 한 번에 이해할 수 있게 정리한 확장 섹션입니다.

## What makes Clawdbot powerful

Clawdbot(OpenClaw)의 강점은 단순한 챗봇이 아니라, **실행 가능한 에이전트 런타임**이라는 점입니다.

핵심 파워 포인트:
- **멀티툴 오케스트레이션**: 파일/쉘/웹/브라우저/메시징/노드 도구를 한 흐름에서 결합
- **세션 중심 설계**: 컨텍스트를 세션 단위로 유지해 작업 연속성이 높음
- **채널 독립성**: Telegram/WhatsApp/Discord 등 채널이 달라도 핵심 에이전트 로직 재사용
- **자동화 내장**: cron/heartbeat/sub-agent로 반복 작업을 사람이 일일이 실행하지 않아도 됨
- **정책 기반 안전장치**: tool allow/deny, 권한, 대상 제한으로 실운영 안전성 확보

요약하면: **“대화 + 실행 + 자동화”가 하나로 묶인 구조**가 강력함의 본질입니다.

---

## What OpenClaw is solving

OpenClaw는 아래 문제를 해결하려고 합니다.

1. **LLM이 답만 하고 행동은 못 하는 문제**
   - OpenClaw는 tool 호출로 실제 파일 수정, 검색, 메시지 전송, 브라우저 조작까지 연결

2. **채널별 봇 구현 중복 문제**
   - 채널 어댑터 위에 공통 에이전트 런타임을 둬서 중복 개발을 줄임

3. **장기 작업/반복 작업 피로 문제**
   - cron + 세션 + 서브에이전트로 작업을 분리하고 예약 실행 가능

4. **운영 가시성 부족 문제**
   - status/health/logging/session-status로 상태 점검 가능

즉, OpenClaw는 **“AI를 실무 도구로 만드는 운영 프레임워크”**에 가깝습니다.

---

## How agent loops actually work

에이전트 루프는 개념적으로 다음과 같습니다.

```text
사용자 입력
  ↓
모델 추론(무엇을 해야 하는가?)
  ↓
도구 호출 결정(필요하면)
  ↓
도구 실행 결과 수집
  ↓
결과를 반영해 다시 추론
  ↓
종료 조건 만족 시 사용자 응답
```

실전에서 중요한 점:
- 루프는 보통 **1~수회 반복**되며, 작업 난이도에 따라 늘어남
- 무한 반복 방지를 위해 loop detection/policy/timeout이 필요
- 각 반복에서 컨텍스트가 과도하게 커지지 않도록 pruning/요약이 중요

OpenClaw dist에서 보이는 `tool-loop-detection-*`, `tool-policy` 계열은 이 루프 안정화와 직접 관련됩니다.

---

## Tool calling, memory, reasoning chains

### 1) Tool calling
- 모델은 “도구가 필요하다”고 판단하면 tool schema에 맞게 호출
- 런타임은 정책 체크 후 실제 도구를 실행하고 결과를 모델에 반환
- 결과적으로 모델은 단순 텍스트 생성기를 넘어 **실행기(executor)**처럼 동작

### 2) Memory
- 단기: 세션 컨텍스트(현재 대화 흐름)
- 장기: `MEMORY.md`, `memory/*.md` 같은 파일 기반 기억
- 검색: `memory_search` → 필요한 줄만 `memory_get`

장점:
- “이전에 뭘 결정했는지”를 잊지 않고 이어서 작업 가능

### 3) Reasoning chains
- 내부 추론은 여러 단계를 거치지만, 사용자에게는 보통 결과 중심으로 노출
- 운영 관점에서 중요한 건 “추론 품질”보다 **도구 실행 정확성 + 컨텍스트 정확성**

즉: tool, memory, reasoning은 따로 노는 기능이 아니라 **하나의 작업 체인**으로 결합됩니다.

---

## How you can experiment and build with it

처음 실험할 때는 아래 순서를 추천합니다.

1. **관측부터**
   - `openclaw status`, `openclaw health --json`으로 상태 확인

2. **작은 자동화 1개**
   - 예: 매일 아침 뉴스 브리핑 cron
   - 성공 기준: 정확한 시간 실행 + 원하는 채널 전달

3. **툴 체인 실험**
   - web_search → web_fetch → 요약 → message 전송

4. **메모리 연결**
   - 반복 의사결정(선호도, 템플릿)을 MEMORY에 저장/회수

5. **서브에이전트 분리**
   - 무거운 분석 작업은 sessions_spawn으로 격리 실행

빌드 관점 확장 아이디어:
- 팀 운영 봇(회의 요약/작업 배정)
- 개인 비서(뉴스, 일정, 리마인드, 리서치)
- 운영 어시스턴트(장애 체크리스트 자동 실행)

---

## 한 줄 정리

OpenClaw의 본질은 **“대화형 인터페이스 위에 도구 실행, 기억, 자동화를 결합한 실전 에이전트 운영 시스템”**입니다.