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

prompt 단계 오류가 없으면, 이번엔 assistant 결과를 보고 처리:

- thinking fallback 재판단 (`L1160~L1170`)
- auth/rate limit/billing/failover 에러 분류 (`L1172~L1176`)
- 이미지 dimension 오류 로그 (`L1178~L1207`)
- profile 회전 조건 계산:
  - failover성 assistant 실패 또는
  - timeout(단, compaction timeout 제외) (`L1209~L1213`)
- 회전 가능하면 다음 profile로 `continue` (`L1237~L1240`)
- profile 소진 + fallback 구성 시 `FailoverError` throw (`L1242~L1276`)

핵심:
- run.ts는 단일 모델 실행기가 아니라 **프로필 로테이션 + failover 브릿지** 역할을 함.

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
