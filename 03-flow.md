# 3) 실행 흐름 (사용자 명령 → 내부 처리 → 응답)

## 3-1. CLI 기준 표준 흐름

```text
[사용자] openclaw status --json
   ↓
openclaw.mjs
   ↓
entry.js
  - 경고 필터
  - env 정규화
  - 프로필/경로 설정
   ↓
run-main-*.js
  - route-first 매칭(status/health 등)
  - 빠른 커맨드는 직접 실행
  - 아니면 program 빌드 + parseAsync
   ↓
(필요 시) gateway RPC / agent runtime / tool 실행
   ↓
결과 출력(JSON/테이블/메시지)
```

## 3-2. 메시징 채널 기준(개념)

```text
[Telegram/WhatsApp/Discord 입력]
   ↓
Gateway 수신
   ↓
세션/권한/도구 정책 결정
   ↓
Agent 실행(LLM + tools)
   ↓
도구 결과 수집/요약
   ↓
원 채널로 응답 전달
```

## 3-3. 도구 호출 흐름

1. 에이전트가 tool 선택
2. tool policy(허용/거부) 확인
3. 실제 도구 실행(exec/web/browser/message 등)
4. 결과를 모델 컨텍스트에 주입
5. 최종 사용자 응답 생성

## 3-4. 실패 시 주로 끊기는 지점
- gateway url/token 불일치
- timeout 과도하게 짧음
- tool policy deny
- 채널 인증 만료
- 모델/provider 키 문제
