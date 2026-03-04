# runEmbeddedAttempt 함수 실행 로직 분석 (코드 위치 포함)

대상 소스:
- `src/agents/pi-embedded-runner/run/attempt.ts`
- 함수: `runEmbeddedAttempt(params)`
- 시작 라인(현재 main 기준): 대략 `L544`

원문 링크:
- https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/run/attempt.ts#L544

> 아래 라인 번호는 upstream 변경에 따라 약간 이동할 수 있음.

---

## 빠른 네비게이션 (섹션 ↔ 코드)

1. 실행 시작/샌드박스: `L547~L572`
2. 스킬/부트스트랩 컨텍스트: `L573~L610`
3. 툴/채널 기능 구성: `L614~L737`
4. 시스템 프롬프트 생성: `L739~L827`
5. 세션 락/세션 매니저 준비: `L829~L899`
6. 세션 생성 + streamFn 파이프라인: `L933~L1135`
7. 히스토리 sanitize/검증/컷: `L1137~L1170`
8. Abort/Timeout/Subscription: `L1179~L1341`
9. 프롬프트 실행 본체: `L1346~L1497`
10. Compaction 대기/스냅샷 선택: `L1499~L1566`
11. 결과 반환 조립: `L1641~L1702`
12. finally 정리: `L1703~L1724`

---

## 1) 실행 시작 & 작업 공간/샌드박스 결정

**코드 위치:** `L547~L572`

```ts
const resolvedWorkspace = resolveUserPath(params.workspaceDir);
const runAbortController = new AbortController();
...
const sandbox = await resolveSandboxContext({ ... });
const effectiveWorkspace = sandbox?.enabled
  ? sandbox.workspaceAccess === "rw" ? resolvedWorkspace : sandbox.workspaceDir
  : resolvedWorkspace;
process.chdir(effectiveWorkspace);
```

핵심:
- workspace 경로 정규화
- sandbox 정책에 따라 실제 cwd 결정
- 이후 모든 상대경로/도구 실행이 `effectiveWorkspace` 기준

---

## 2) 스킬/부트스트랩/컨텍스트 파일 주입

**코드 위치:** `L573~L610`

관련 함수:
- `resolveEmbeddedRunSkillEntries`
- `applySkillEnvOverridesFromSnapshot` / `applySkillEnvOverrides`
- `resolveSkillsPromptForRun`
- `resolveBootstrapContextForRun`

```ts
const { shouldLoadSkillEntries, skillEntries } = resolveEmbeddedRunSkillEntries(...);
restoreSkillEnv = params.skillsSnapshot
  ? applySkillEnvOverridesFromSnapshot(...)
  : applySkillEnvOverrides(...);

const skillsPrompt = resolveSkillsPromptForRun(...);
const { bootstrapFiles, contextFiles } = await resolveBootstrapContextForRun(...);
```

핵심:
- 런타임 스킬/부트스트랩 문맥을 프롬프트 생성 재료로 확보
- 실행 종료 시 `restoreSkillEnv`로 환경 복구

---

## 3) 에이전트/툴 구성

**코드 위치:** `L614~L737`

관련 함수:
- `resolveSessionAgentIds`
- `createOpenClawCodingTools`
- `sanitizeToolsForGoogle`
- `collectAllowedToolNames`
- `resolveChannelCapabilities`, `resolveTelegramInlineButtonsScope`

```ts
const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds(...);
const toolsRaw = params.disableTools ? [] : createOpenClawCodingTools({ ... });
const tools = sanitizeToolsForGoogle({ tools: toolsRaw, provider: params.provider });
const allowedToolNames = collectAllowedToolNames({ tools, clientTools: params.clientTools });
```

핵심:
- 세션/채널/모델 상태를 반영한 도구 집합 구성
- `allowedToolNames`는 뒤에서 tool call name 정규화에 재사용

---

## 4) 시스템 프롬프트 빌드

**코드 위치:** `L739~L827`

관련 함수:
- `buildSystemPromptParams`
- `buildEmbeddedSystemPrompt`
- `buildSystemPromptReport`
- `createSystemPromptOverride`

```ts
const { runtimeInfo, userTimezone, userTime } = buildSystemPromptParams(...);
const appendPrompt = buildEmbeddedSystemPrompt({ ..., tools, contextFiles, ... });
const systemPromptReport = buildSystemPromptReport({ systemPrompt: appendPrompt, ... });
let systemPromptText = createSystemPromptOverride(appendPrompt)();
```

핵심:
- 런타임/채널/스킬/컨텍스트 파일 정보를 하나의 system prompt로 합성
- report 객체로 추적 가능성 확보

---

## 5) 세션 파일 락 + 세션 매니저 초기화

**코드 위치:** `L829~L899`

관련 함수:
- `acquireSessionWriteLock`
- `repairSessionFileIfNeeded`
- `SessionManager.open` + `guardSessionManager`
- `prepareSessionManagerForRun`
- `buildEmbeddedExtensionFactories`

```ts
const sessionLock = await acquireSessionWriteLock({ ... });
await repairSessionFileIfNeeded({ sessionFile: params.sessionFile, ... });
sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), { ... });
await prepareSessionManagerForRun({ sessionManager, ... });
```

핵심:
- 동시성/세션 손상/tool-result 불일치에 대한 방어 지점

---

## 6) Agent 세션 생성 & streamFn 파이프라인

**코드 위치:** `L933~L1135`

### 6-1. 세션 생성
```ts
({ session } = await createAgentSession({
  model: params.model,
  tools: builtInTools,
  customTools: allCustomTools,
  sessionManager,
  ...
}));
```

### 6-2. 제공자별 streamFn 선택
```ts
if (params.model.api === "ollama") {
  activeSession.agent.streamFn = createOllamaStreamFn(ollamaBaseUrl);
} else if (params.model.api === "openai-responses" && params.provider === "openai") {
  activeSession.agent.streamFn = createOpenAIWebSocketStreamFn(...);
} else {
  activeSession.agent.streamFn = streamSimple;
}
```

### 6-3. 래퍼 체인 (호환/안정화)
- `wrapOllamaCompatNumCtx` (`L1011~L1030`)
- `dropThinkingBlocks` 래핑 (`L1051~L1072`)
- `sanitizeToolCallIdsForCloudCodeAssist` (`L1074~L1098`)
- `downgradeOpenAIFunctionCallReasoningPairs` (`L1100~L1121`)
- `wrapStreamFnTrimToolCallNames` (`L1123~L1129`)

핵심:
- 모델별 포맷 차이/엄격 검증 이슈를 스트림 경계에서 흡수

---

## 7) 히스토리 sanitize/검증/트렁케이션

**코드 위치:** `L1137~L1170`

```ts
const prior = await sanitizeSessionHistory({ ... });
const validatedGemini = transcriptPolicy.validateGeminiTurns ? validateGeminiTurns(prior) : prior;
const validated = transcriptPolicy.validateAnthropicTurns ? validateAnthropicTurns(validatedGemini) : validatedGemini;
const truncated = limitHistoryTurns(validated, getDmHistoryLimitFromSessionKey(...));
const limited = transcriptPolicy.repairToolUseResultPairing
  ? sanitizeToolUseResultPairing(truncated)
  : truncated;
activeSession.agent.replaceMessages(limited);
```

핵심:
- “과거 메시지가 이미 깨진 상태”를 실행 직전에 최대한 정리

---

## 8) Abort/Timeout/Subscription 제어

**코드 위치:** `L1179~L1341`

관련 함수:
- `abortRun`, `abortable`
- `subscribeEmbeddedPiSession`
- `setActiveEmbeddedRun`
- `shouldFlagCompactionTimeout`

```ts
const abortRun = (isTimeout = false, reason?: unknown) => { ... void activeSession.abort(); };
const subscription = subscribeEmbeddedPiSession({ session: activeSession, ... });
setActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
const abortTimer = setTimeout(() => { ... abortRun(true); }, Math.max(1, params.timeoutMs));
```

핵심:
- 실행 중단/타임아웃/컴팩션 타임아웃을 구분해서 상태 관리

---

## 9) 프롬프트 실행 본체

**코드 위치:** `L1346~L1497`

관련 함수:
- `resolvePromptBuildHookResult`
- `pruneProcessedHistoryImages`
- `detectAndLoadPromptImages`
- `activeSession.prompt`

```ts
const hookResult = await resolvePromptBuildHookResult({ ... });
if (hookResult?.prependContext) effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
...
const imageResult = await detectAndLoadPromptImages({ prompt: effectivePrompt, ... });
await abortable(activeSession.prompt(effectivePrompt, imageResult.images.length > 0 ? { images: imageResult.images } : undefined));
```

핵심:
- 훅 기반 프롬프트 변형 + 이미지 로딩 + 실제 모델 호출

---

## 10) Compaction 대기 & 스냅샷 선택

**코드 위치:** `L1499~L1566`

관련 함수:
- `waitForCompactionRetry`
- `appendCacheTtlTimestamp`
- `selectCompactionTimeoutSnapshot`

```ts
const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
await abortable(waitForCompactionRetry());
...
const snapshotSelection = selectCompactionTimeoutSnapshot({
  timedOutDuringCompaction,
  preCompactionSnapshot,
  currentSnapshot: activeSession.messages.slice(),
  ...
});
messagesSnapshot = snapshotSelection.messagesSnapshot;
```

핵심:
- compaction 경계에서 레이스가 나도 일관된 결과 스냅샷 선택

---

## 11) 결과 조립 & 반환

**코드 위치:** `L1641~L1702`

```ts
const lastAssistant = messagesSnapshot.slice().toReversed().find((m) => m.role === "assistant");
...
return {
  aborted,
  timedOut,
  timedOutDuringCompaction,
  promptError,
  systemPromptReport,
  messagesSnapshot,
  assistantTexts,
  toolMetas: toolMetasNormalized,
  ...
};
```

핵심:
- 실행 결과 + 관측 데이터 + 메시징/툴 실행 결과를 한 객체로 반환

---

## 12) finally 정리 (누수 방지 핵심)

**코드 위치:** `L1703~L1724`

```ts
removeToolResultContextGuard?.();
await flushPendingToolResultsAfterIdle({ agent: session?.agent, sessionManager });
session?.dispose();
releaseWsSession(params.sessionId);
await sessionLock.release();
...
restoreSkillEnv?.();
process.chdir(prevCwd);
```

핵심:
- 실패/중단/타임아웃 여부와 무관하게 세션 락/리소스/cwd/env를 복구

---

## 참고: 같이 보면 좋은 내부 함수

- 같은 파일 상단 helper
  - `wrapOllamaCompatNumCtx`
  - `wrapStreamFnTrimToolCallNames`
  - `resolvePromptBuildHookResult`
  - `resolveAttemptFsWorkspaceOnly`
- 인접 모듈
  - `./compaction-timeout.ts`
  - `./images.ts`
  - `../system-prompt.ts`
  - `../google.ts`

---

## 결론
이 함수는 “LLM 호출 함수”가 아니라,
**세션/툴/프롬프트/중단/컴팩션/호환성/정리**를 한 번에 다루는 실행 오케스트레이터다.

원하면 다음 버전에서 섹션별로 **GitHub 라인 앵커 링크(`#Lxxx-Lyyy`)**를 전부 붙여서,
클릭하면 해당 코드로 바로 점프되게 정리해줄게.
