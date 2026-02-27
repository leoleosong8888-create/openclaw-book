# 1) 아키텍처 개요도 (텍스트/다이어그램)

## 1-1. 큰 흐름

```text
사용자(터미널/채팅)
   ↓
openclaw.mjs (부트스트랩, 엔트리 로딩)
   ↓
dist/entry.js (환경/경로/로그/프로필 처리)
   ↓
dist/run-main-*.js (CLI 명령 라우팅)
   ├─ 상태/헬스/세션/모델 등 빠른 route-first 실행
   └─ 일반 명령은 program 빌드 후 서브커맨드로 전달
          ↓
       agent runtime / tools / gateway RPC
          ↓
       채널(telegram/whatsapp/discord...) 또는 CLI 응답
```

## 1-2. 계층별 역할

### Core 계층
- 프로세스 시작, 환경변수 정규화, 상태 디렉터리(`~/.openclaw`) 결정
- 로깅/콘솔 캡처/TTY 처리
- CLI 명령 파싱과 빠른 라우팅

### LLM 계층
- 모델 선택(기본 provider/model 해석)
- 임베디드 에이전트 실행(runEmbeddedPiAgent)
- 예시: 세션명 슬러그 자동 생성(`llm-slug-generator.js`)

### Plan 계층(실제는 분산)
- 별도 `plan/` 디렉터리보다, 실행 정책이 여러 파일에 분산:
  - 명령 라우팅(`run-main`)
  - 도구 허용 정책(`pi-tools.policy-*`, tool policy 관련 모듈)
  - 루프 방지(`tool-loop-detection-*`)

### sGateway/Gateway 계층
- CLI 쪽 RPC 호출 유틸(`gateway-rpc-*.js`)
- 서버/프로토콜 타입 계약(`plugin-sdk/gateway/protocol/schema*.d.ts`)
- cron/nodes/sessions/channels 같은 원격 제어 표준화

### Tools 계층
- 도구 목록/그룹/프로필(`tool-catalog-*.js`)
- 런타임 도구 조립(`plugin-sdk/agents/openclaw-tools.d.ts`)
- 각 도구의 스키마/권한/세션 연결 정보 처리

## 1-3. 의존 관계(간단)

```text
core(entry/run-main)
  ├─ gateway-rpc (원격 제어)
  ├─ tools catalog/policy (행동 범위)
  └─ llm runtime (모델 추론)

gateway protocol(schema d.ts)
  └─ cli + tools + channels가 공통으로 참조하는 계약층
```
