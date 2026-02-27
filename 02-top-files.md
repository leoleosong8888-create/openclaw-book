# 2) 핵심 파일 Top N

아래는 실제 설치본에서 분석 우선순위가 높은 파일들입니다.

## 요약표

| 우선 | 파일 | 역할 한 줄 |
|---|---|---|
| 1 | `openclaw.mjs` | 실행 진입점(부트스트랩, entry 로딩) |
| 2 | `dist/entry.js` | core 초기화(환경/경로/로그/프로필/플러그인 기반) |
| 3 | `dist/run-main-TmPntmYV.js` | CLI 라우팅 엔진(route-first + program parse) |
| 4 | `dist/gateway-rpc-BFyAKcJO.js` | CLI → Gateway RPC 공통 호출 래퍼 |
| 5 | `dist/tool-catalog-BS-Gk_Yg.js` | 기본 도구 카탈로그/그룹/프로필 정책 |
| 6 | `dist/llm-slug-generator.js` | LLM 호출 예제(짧은 슬러그 생성 훅) |
| 7 | `dist/plugin-sdk/agents/openclaw-tools.d.ts` | 에이전트 도구 조립 API 시그니처 |
| 8 | `dist/plugin-sdk/gateway/protocol/schema.d.ts` | Gateway 프로토콜 스키마 export 허브 |
| 9 | `dist/plugin-sdk/gateway/server-methods/types.d.ts` | Gateway 요청 컨텍스트/핸들러 타입 계약 |
| 10 | `dist/cli/daemon-cli.js` | 레거시 데몬 CLI 호환 shim |

---

## 파일별 상세

### 1) `openclaw.mjs`
- **입력**: 프로세스 실행 인자, 로컬 dist 존재 여부
- **출력**: `dist/entry.js` 또는 `entry.mjs` 로딩
- **의존성**: Node module compile cache, warning filter
- **주의점**:
  - 이 파일 자체는 얇고, 실제 로직은 거의 `dist/entry.js`에 있음
  - 배포 손상 시 `missing dist/entry.(m)js` 에러를 내는 안전장치

### 2) `dist/entry.js`
- **역할**: 실질적인 core 집합체
- **핵심 기능**:
  - 홈/상태/설정 경로 해석 (`OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`)
  - 로그 시스템 구성(파일+콘솔, 레벨/스타일/로테이션)
  - 플러그인 명령/훅 레지스트리
  - 채널 메타/별칭 정규화
- **입출력**:
  - 입력: env, argv, config(json5)
  - 출력: 런타임 전역 설정, logger, registry 상태
- **주의점**:
  - 파일이 매우 커서 직접 수정은 리스크 큼(번들 산출물)
  - 경로/환경변수 로직 변경 시 전체 동작에 파급

### 3) `dist/run-main-TmPntmYV.js`
- **역할**: 실행 라우터(명령별 핫패스)
- **핵심 포인트**:
  - `routeHealth`, `routeStatus` 등 빠른 분기
  - 일반 명령은 동적 import 후 `program.parseAsync`
  - 플러그인 커맨드 등록 조건 분기
- **주의점**:
  - route-first 최적화가 있어 디버깅 시 분기 경로를 먼저 확인해야 함

### 4) `dist/gateway-rpc-BFyAKcJO.js`
- **역할**: CLI에서 Gateway RPC 호출할 때 공통 옵션/프로그레스 처리
- **입력**: method, url/token/timeout, params
- **출력**: callGateway 결과(성공/실패)
- **주의점**:
  - 타임아웃/expect-final 옵션 영향이 큼

### 5) `dist/tool-catalog-BS-Gk_Yg.js`
- **역할**: 도구 표준 카탈로그와 프로필 정책 정의
- **핵심 기능**:
  - 섹션(fs/runtime/web/...)
  - profile(minimal/coding/messaging/full)
  - group(openclaw, group:fs 등)
- **주의점**:
  - 도구 허용 범위 변경 시 보안/권한 동작이 달라짐

### 6) `dist/llm-slug-generator.js`
- **역할**: 대화 요약 기반 슬러그 생성용 LLM 훅
- **핵심 흐름**:
  - 임시 session 파일 생성 → prompt 작성 → `runEmbeddedPiAgent` 호출 → 문자열 정제
- **의미**:
  - OpenClaw 내부에서 LLM 호출이 어떻게 포장되는지 이해하기 좋은 샘플

### 7) `dist/plugin-sdk/agents/openclaw-tools.d.ts`
- **역할**: `createOpenClawTools(options)` API 계약
- **핵심 파라미터**:
  - session/channel/thread/account 문맥
  - sandbox/workspace/fsPolicy
  - 메시지 툴 강제 타깃/비활성화 옵션
- **주의점**:
  - 멀티채널/멀티세션 문맥 전달을 잘못 다루면 오발송 가능

### 8) `dist/plugin-sdk/gateway/protocol/schema.d.ts`
- **역할**: Gateway 스키마 묶음 export(agents/channels/cron/sessions 등)
- **의미**:
  - 실제 wire contract의 관문

### 9) `dist/plugin-sdk/gateway/server-methods/types.d.ts`
- **역할**: Gateway 요청 핸들러가 받는 context 타입
- **핵심 요소**:
  - cron 서비스, exec approval, node registry, 채널 start/stop
- **주의점**:
  - 서버 측 기능 간 결합도를 파악하기 좋은 파일

### 10) `dist/cli/daemon-cli.js`
- **역할**: 레거시 export 호환 shim
- **의미**:
  - 과거 API와 현재 빌드 사이 호환 처리 위치
