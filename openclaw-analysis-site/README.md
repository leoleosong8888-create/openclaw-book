# OpenClaw 소스코드 분석 문서

이 문서는 **OpenClaw 설치본(dist 기준)**을 역분석해, 주요 파일의 역할을 비개발자도 이해할 수 있게 정리한 자료입니다.

## 분석 범위
- core
- llm
- plan(관련 계층)
- sgateway/gateway
- tools

> 참고: 현재 설치본(`openclaw 2026.2.25`)에서는 `plan`, `sgateway`라는 디렉터리명이 직접 보이지 않습니다.  
> 그래서 본 문서에서는 해당 범위를 **실행 계획/라우팅 계층(run-main, tool policy)** 및 **gateway 계층**으로 매핑해 설명합니다.

## 한눈에 보는 결론
- **core**: `openclaw.mjs → dist/entry.js → dist/run-main-*.js`가 부팅/라우팅의 핵심
- **llm**: 모델 선택/실행은 agent runtime 쪽, 샘플로 `llm-slug-generator.js`가 LLM 호출 흐름을 잘 보여줌
- **plan**: 독립 모듈보다는 "명령 라우팅 + 도구 정책 + 실행 루프"에 분산
- **gateway**: CLI는 `gateway-rpc-*.js`로 RPC 호출, 실제 계약은 `plugin-sdk/gateway/protocol/schema*.d.ts`
- **tools**: `tool-catalog-*.js`, `plugin-sdk/agents/openclaw-tools.d.ts`가 도구 카탈로그/조립 포인트

## 문서 사용법
1. 아키텍처(큰 그림)부터 보고
2. Top N 파일로 핵심 코드 위치를 잡고
3. 실행 흐름/운영 팁으로 실제 수정 경로를 잡으면 됩니다.
4. 사이드바의 **한국 날씨 그래프 대시보드**에서 실시간 시각화도 확인할 수 있습니다.
