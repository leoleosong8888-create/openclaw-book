# agents/pi-embedded-runner/run.ts 분석

대상 소스:
- `src/agents/pi-embedded-runner/run.ts`
- 초점: `runEmbeddedAttempt(...)` 호출 **이후** 처리 흐름

원문:
- https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/run.ts

---

## 어디서 호출되나

`while (true)` 재시도 루프 안에서 호출됨.

- 호출: `runEmbeddedAttempt(...)` (`대략 L762`)
- 결과 구조 분해: `aborted / promptError / timedOut / ...` (`L827~L834`)

즉 `run.ts`는 attempt를 1회 실행하고, 그 결과를 보고 **재시도/복구/실패/성공 반환**을 결정하는 상위 오케스트레이터다.

---

## 호출 직후 즉시 하는 일

### 1) 경고 시그니처/사용량/컴팩션 카운트 누적 (`L835~L853`)

```ts
bootstrapPromptWarningSignaturesSeen = ...
const lastAssistantUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
const attemptUsage = attempt.attemptUsage ?? lastAssistantUsage;
mergeUsageIntoAccumulator(usageAccumulator, attemptUsage);
lastRunPromptUsage = lastAssistantUsage ?? attemptUsage;
lastTurnTotal = lastAssistantUsage?.total ?? attemptUsage?.total;
autoCompactionCount += Math.max(0, attempt.compactionCount ?? 0);
```

핵심:
- 1회 attempt usage를 누적해 최종 `agentMeta.usage` 구성
- 마지막 API 호출 usage를 따로 보관(`lastRunPromptUsage`)해서 context 사용량 표시 정확도 확보

---

## 가장 먼저 보는 분기: Context Overflow 복구 (`L872~L1056`)

### overflow 감지
- `promptError` 또는 `assistantErrorText` 중 overflow 패턴 탐지

### 복구 순서
1. **in-attempt compaction이 이미 있었으면** 즉시 재시도(중복 compaction 피함) (`L903~L915`)
2. 아니면 **명시적 compaction 실행** `compactEmbeddedPiSessionDirect(...)` (`L918~L964`)
3. 그래도 실패 시 **oversized tool result truncation** 시도 (`L969~L1011`)
4. 한도 초과/실패 시 사용자 에러 반환 (`context_overflow` 또는 `compaction_failure`) (`L1031~L1055`)

핵심:
- 단순 실패 반환이 아니라, overflow는 복구 루틴을 여러 단계로 시도함.

---

## promptError 분기 처리 (`L1058~L1158`)

`promptError && !aborted`인 경우:

1. Copilot auth refresh 가능하면 refresh 후 재시도 (`L1060~L1063`)
2. role ordering 오류면 사용자 친화 메시지 즉시 반환 (`L1065~L1089`)
3. image size 오류면 친화 메시지 즉시 반환 (`L1091~L1122`)
4. failover 대상 오류면
   - auth profile 실패 마킹 (`maybeMarkAuthProfileFailure`) (`L1123~L1128`)
   - 다음 profile로 회전 가능하면 재시도 (`L1129~L1134`)
5. thinking level fallback 가능하면 레벨 변경 후 재시도 (`L1135~L1145`)
6. fallback 설정 시 `FailoverError` throw로 상위 모델 failover 진입 (`L1148~L1156`)
7. 아니면 원래 `promptError` throw (`L1157`)

---

## assistant 응답 기반 후처리 (`L1160~L1277`)

이 구간은 한마디로 **"assistant 결과를 보고 복구 전략을 고르는 라우팅 레이어"**다.

`promptError` 단계는 통과했더라도, assistant 응답 내용(에러 텍스트/타임아웃/정책 실패)을 분석해
- 현재 profile에서 한 번 더 해볼지,
- 다른 profile로 넘길지,
- 아니면 상위 failover 체인으로 승격할지
를 결정한다.

### 0) 왜 이 단계가 따로 필요한가

`runEmbeddedAttempt(...)` 결과에는 "실패"만 있는 게 아니라 실패의 성격이 섞여 있다.
예를 들어:
- 같은 timeout이라도 일시적 네트워크 지연인지,
- compaction 과정의 timeout인지,
- 인증/과금 같은 구조적 실패인지에 따라
복구 방식이 완전히 달라진다.

그래서 여기서 **실패를 재분류**하고 **복구 우선순위**를 정한다.

---

### 1) thinking fallback 재판단 (`L1160~L1170`)

이전 분기(promptError)에서 이미 thinking fallback을 검토했더라도,
assistant 응답의 실제 에러 신호를 보고 한 번 더 판단한다.

의미:
- 사전 판단(prompt 단계) + 사후 판단(assistant 단계) 이중 안전장치
- 잘못된 thinking 레벨로 인한 불필요한 실패를 줄임

즉, "한 번 본 걸 다시 본다"가 아니라,
**다른 관측치(assistant 결과)를 기반으로 재평가**하는 단계다.

---

### 2) assistant 에러 클래스 분류 (`L1172~L1176`)

assistant 실패를 운영 관점에서 중요한 카테고리로 분해한다.

대표 분류:
- auth 계열
- rate limit 계열
- billing/quota 계열
- failover 후보 에러

이 분류값은 뒤의 핵심 분기(프로필 회전 여부, FailoverError throw 여부)에 직접 사용된다.

핵심 포인트:
- 단순 문자열 비교가 아니라,
- "재시도로 회복 가능한지" vs "경로를 바꿔야 하는지"를 가르는 용도.

---

### 3) 이미지 dimension 오류 처리 강화 (`L1178~L1207`)

이미지 크기/차원 관련 오류는 사용자 입력 문제일 수도, 모델 제한 문제일 수도 있다.
이 구간에서 해당 케이스를 별도로 기록/진단해 이후 분석 가능성을 높인다.

효과:
- 동일 오류 재발 시 원인 추적이 빨라짐
- "왜 실패했는지"를 운영 로그에서 분리해 확인 가능

---

### 4) profile 회전 트리거 계산 (`L1209~L1213`)

다음 profile로 넘어가야 하는지 계산한다. 주된 조건은:

1. failover 성격의 assistant 실패
2. timeout 발생
   - 단, **compaction timeout은 제외**

`compaction timeout`을 제외하는 이유:
- compaction은 복구 시도 자체라서, 이를 일반 모델 실패로 간주하면 profile을 과도하게 소모할 수 있음
- 즉, **복구 단계의 지연**과 **실행 경로 자체의 실패**를 구분함

---

### 5) 회전 가능하면 즉시 다음 profile로 continue (`L1237~L1240`)

현재 profile을 붙잡고 같은 실패를 반복하지 않고,
가능한 경우 바로 다음 auth profile로 넘어가 재시도한다.

의미:
- 장애 profile에 대한 체류 시간 감소
- 사용자 관점에서 성공 확률/응답성 개선

`run.ts`가 "단순 재시도 루프"가 아니라
**프로필 로테이터** 역할을 수행하는 지점이다.

---

### 6) profile 소진 시 상위 failover로 승격 (`L1242~L1276`)

모든 profile을 소진했는데도 회복되지 않으면,
로컬(profile 단위) 복구를 종료하고 `FailoverError`를 throw한다.

그러면 상위 계층이 모델/provider 레벨 failover를 수행할 수 있다.

계층 구조로 보면:
- 현재 구간: profile 레벨 복구
- 상위 핸들러: 모델/provider 레벨 복구

즉, **로컬에서 할 수 있는 건 다 한 뒤 상위로 책임을 넘기는 경계점**이다.

---

### 이 구간의 전체 흐름(요약)

1. assistant 결과 재해석
2. thinking 조정 필요성 재판단
3. 에러 타입 분류(auth/rate/billing/failover)
4. profile 회전 여부 판정(타임아웃/실패 성격 기반)
5. 회전 가능 시 즉시 다음 profile
6. profile 소진 시 `FailoverError`로 상위 체인 진입

한 줄로 정리하면,
`L1160~L1277`은 **assistant 결과 기반의 복구 폭 확장 단계**다.
(동일 profile 재시도 → profile 회전 → 상위 failover 승격)

---

## 성공 경로: payload/meta 조립 후 반환 (`L1279~L1388`)

### 1) usage/agentMeta 구성 (`L1279~L1298`)

```ts
const usage = toNormalizedUsage(usageAccumulator);
if (usage && lastTurnTotal && lastTurnTotal > 0) usage.total = lastTurnTotal;
const lastCallUsage = normalizeUsage(lastAssistant?.usage as UsageLike);
const agentMeta = { sessionId, provider, model, usage, lastCallUsage, promptTokens, compactionCount };
```

### 2) 최종 payload 생성 (`L1300~L1315`)
- `buildEmbeddedRunPayloads(...)`로 assistant text/tool 메타를 사용자 응답 포맷으로 변환

### 3) timeout인데 payload 비어 있으면 명시적 에러 반환 (`L1317~L1342`)
- 유저 턴이 고아 상태로 끝나지 않게 보호

### 4) 정상 반환 (`L1360~L1388`)
- payload + meta + messaging tool 전송 결과 + cron 결과 포함
- client tool call이 있으면 `stopReason: "tool_calls"`, `pendingToolCalls`도 채움

---

## 공통 정리(finish)

`finally`에서 항상 실행:
- `stopCopilotRefreshTimer()`
- `process.chdir(prevCwd)`

(`L1390~L1393`)

---

## runEmbeddedAttempt 이후 처리의 본질

`runEmbeddedAttempt`가 "한 번 실행"이라면,
`run.ts`는 그 결과를 바탕으로:

1. 오류를 **분류**하고,
2. 가능한 복구(compaction/truncation/refresh/profile rotation/thinking fallback)를 **순차 시도**하고,
3. 성공 시 표준 payload/meta로 **정규화 반환**하거나,
4. 실패 시 사용자 친화 오류 혹은 `FailoverError`로 **상위 fallback 체인**에 위임한다.

즉, `run.ts`의 post-attempt 코드는 OpenClaw의 실제 "회복 탄력성(resilience)"을 담당하는 핵심 루프다.
