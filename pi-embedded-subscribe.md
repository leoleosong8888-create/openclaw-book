# agents/pi-embedded-subscribe.ts 분석

대상 소스:
- `src/agents/pi-embedded-subscribe.ts`
- 원문: https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-subscribe.ts

---

## 이 함수가 하는 일 (한 줄 요약)

`subscribeEmbeddedPiSession(params)`는 **PI 세션 스트리밍 이벤트를 구독**해서,
assistant 텍스트/툴 메타/사용량/컴팩션 상태를 수집하고,
최종적으로 `run.ts`가 후처리할 수 있는 형태로 제공하는 **어댑터 함수**다.

즉, 모델 스트림의 "날것 이벤트"를 `assistantTexts`, `toolMetas`, `lastToolError`, `usageTotals` 같은
런타임 친화 구조로 변환한다.

---

## 입력/출력 관점에서 보기

### 입력 (`params`)

핵심적으로 다음 정보를 받는다.

- `session`: PI Agent Session (이벤트 subscribe 대상)
- `runId`: 런 식별자 (로그/이벤트 연계)
- `verboseLevel`, `reasoningMode`, `toolResultFormat`: 출력 정책
- `onBlockReply`, `onPartialReply`, `onReasoningStream`, `onToolResult` 등 콜백
- `enforceFinalTag`, `blockReplyChunking`: 텍스트 정제/청크 정책

### 출력 (반환 객체)

반환 객체는 `runEmbeddedAttempt(...)`가 바로 쓰는 런타임 핸들이다.

- 데이터:
  - `assistantTexts`
  - `toolMetas`
  - `getLastToolError()`
  - `getUsageTotals()`
  - `getCompactionCount()`
- 상태/동기화:
  - `isCompacting()`
  - `waitForCompactionRetry()`
- 메시징 도구 중복 억제용:
  - `didSendViaMessagingTool()`
  - `getMessagingToolSentTexts()`
  - `getMessagingToolSentTargets()`
  - `getMessagingToolSentMediaUrls()`
- 라이프사이클:
  - `unsubscribe()`

---

## 내부 동작 핵심

## 1) 상태 초기화: 스트림 누적 버퍼 + 중복 억제 상태

함수 시작 시 `state`를 만든다.

- `assistantTexts`, `toolMetas`: 최종 payload의 원천 데이터
- `deltaBuffer`, `blockBuffer`: 스트리밍 텍스트 누적 버퍼
- `blockState`, `partialBlockState`: `<think>/<final>` 태그 상태 머신
- `lastAssistantText*`: 동일 텍스트 중복 삽입 방지
- `messagingToolSent*`: message tool로 이미 보낸 텍스트/대상/미디어 추적
- `compaction*`: 컴팩션 재시도 동기화용 상태

의미:
- provider 스트림이 완벽히 정렬/단발성이라는 가정 없이,
- **중복/순서 꼬임/지연 이벤트**를 견디는 구조로 설계됨.

---

## 2) assistant 텍스트 누적 정책

핵심 헬퍼:
- `shouldSkipAssistantText`
- `pushAssistantText`
- `finalizeAssistantTexts`

포인트:
- 같은 assistant 메시지 내 중복 chunk를 normalized 비교로 제거
- reasoning 모드/블록 콜백 여부에 따라 "스트리밍 중간 텍스트"와 "최종 텍스트"를 병합
- non-streaming 모델(최종 text만 도착)도 누락 없이 `assistantTexts`에 반영

결과:
- `assistantTexts`가 이후 `buildEmbeddedRunPayloads(...)`의 **1순위 답변 소스**가 됨.

---

## 3) `<think>` / `<final>` 태그 정제

`stripBlockTags(...)`가 핵심이다.

- `<think>` 내부 텍스트는 사용자 노출에서 제거
- `enforceFinalTag=true`면 `<final>...</final>` 내부만 노출
- 코드블록/인라인코드 내부 태그는 오탐 제거(`buildCodeSpanIndex` 사용)
- 경계가 chunk 사이에 걸쳐도 상태(`state.thinking`, `state.final`) 유지

효과:
- 체인오브소트/중간 추론 누출 방지
- 모델이 태그를 흔들거나 환각으로 태그를 섞어도 상대적으로 안전

---

## 4) 블록 응답 스트리밍과 reply directive 처리

`emitBlockChunk(...)`에서:

1. 태그 정제 + downgraded tool call 텍스트 제거
2. 중복 메시지 억제(최근 block 중복, assistant text 중복, messaging tool 중복)
3. `parseReplyDirectives`/accumulator로
   - `[[reply_to_current]]`
   - media URL
   - audioAsVoice
   등을 분리
4. `onBlockReply` 콜백으로 상위로 전달

즉, 단순 텍스트 스트림이 아니라 **메시징 채널 친화 payload 단위**로 가공한다.

---

## 5) tool 결과/오류/요약 수집

- `emitToolSummary`, `emitToolOutput`로 툴 실행 정보를 텍스트화
- `toolResultFormat`에 따라 markdown/plain 포맷 조정
- media URL은 `filterToolResultMediaUrls`로 필터
- 실패 정보는 `lastToolError`에 보관되어 후속 경고 정책에서 활용

---

## 6) usage 누적

`recordAssistantUsage` + `getUsageTotals`:

- 이벤트마다 usage를 normalize해서 누적
- input/output/cacheRead/cacheWrite/total을 합산
- 최종 attempt usage로 반환되어 `run.ts`의 usage accumulator에 병합됨

---

## 7) compaction 동기화 (`waitForCompactionRetry`)

이 함수의 안정성 포인트 중 하나.

- 컴팩션 중/재시도 대기 중이면 Promise 기반으로 대기
- 여러 컴팩션 재시도를 카운터(`pendingCompactionRetry`)로 추적
- 전부 끝났을 때만 resolve
- `unsubscribe()` 이후에는 resolve가 아니라 `AbortError` reject
  - 상위가 "정상 완료"로 오해하지 않게 설계

---

## 8) unsubscribe 안전 종료

`unsubscribe()`는 단순 해제가 아니라 안전한 teardown이다.

- `unsubscribed`를 먼저 true로 설정 (경쟁 상태 방지)
- pending compaction promise를 `AbortError`로 reject
- compaction 실행 중이면 `session.abortCompaction()` 시도
- 마지막으로 실제 `sessionUnsubscribe()` 수행

효과:
- 종료 중 hung promise/리소스 누수 가능성 감소

---

## run.ts와의 연결점

`runEmbeddedAttempt(...)`에서 이 반환값을 그대로 사용한다.

- `assistantTexts`, `toolMetas`, `lastAssistant`, `attemptUsage`를 조립해 attempt 결과 반환
- 이후 `run.ts`가 `buildEmbeddedRunPayloads(...)` 호출 시
  - `assistantTexts`를 우선 payload source로 사용
  - 필요 시 `lastAssistant` fallback 사용

즉 `subscribeEmbeddedPiSession`은
**"스트림 이벤트 수집기" + "출력 정제기" + "동기화 게이트(compaction)"** 역할을 동시에 수행한다.

---

## 실무적으로 중요한 포인트 3가지

1. **응답 중복 억제**
   - provider 재전송/지연/툴 전송 중복 상황에서 사용자 체감 노이즈 감소

2. **추론 텍스트 누출 방지**
   - `<think>/<final>` 기반 필터링과 태그 상태 추적으로 안전성 강화

3. **컴팩션 경합 안정화**
   - compaction retry 대기를 명시적으로 관리해 run 루프 판단 정확도 확보

---

## 한 줄 결론

`subscribeEmbeddedPiSession`은 OpenClaw의 embedded 실행에서
**"LLM 스트림을 사용자 응답으로 바꿔주는 핵심 변환 레이어"**다.
