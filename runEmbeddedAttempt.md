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

## 5) 세션 파일 락 + 세션 매니저 초기화 (상세)

**코드 위치:** `L829~L899`

관련 함수:
- `acquireSessionWriteLock`
- `resolveSessionLockMaxHoldFromTimeout`
- `repairSessionFileIfNeeded`
- `prewarmSessionFile`
- `SessionManager.open` + `guardSessionManager`
- `trackSessionManagerAccess`
- `prepareSessionManagerForRun`
- `createPreparedEmbeddedPiSettingsManager`
- `buildEmbeddedExtensionFactories`
- `DefaultResourceLoader(...).reload()`

### 5-1) 먼저 락을 잡는 이유

```ts
const sessionLock = await acquireSessionWriteLock({
  sessionFile: params.sessionFile,
  maxHoldMs: resolveSessionLockMaxHoldFromTimeout({ timeoutMs: params.timeoutMs }),
});
```

핵심 포인트:
- 세션 파일은 여러 런/스레드가 동시에 접근할 수 있으므로, **쓰기 락을 선점**해서 경쟁 상태를 막는다.
- `maxHoldMs`는 요청 timeout을 기반으로 잡혀서, 비정상 장기 점유를 줄인다.

### 5-2) 파일 복구 + 존재 여부 판단

```ts
await repairSessionFileIfNeeded({ sessionFile: params.sessionFile, warn: ... });
const hadSessionFile = await fs.stat(params.sessionFile).then(() => true).catch(() => false);
```

무슨 문제를 막나:
- 이전 실행 중단/크래시로 세션 파일이 깨졌을 수 있음 → 사전 복구
- 기존 세션인지 신규 세션인지(`hadSessionFile`)를 뒤 초기화 로직에서 분기 기준으로 활용

### 5-3) transcript 정책 계산 (가드 옵션에 영향)

```ts
const transcriptPolicy = resolveTranscriptPolicy({
  modelApi: params.model?.api,
  provider: params.provider,
  modelId: params.modelId,
});
```

왜 여기서 하냐:
- 세션 매니저 가드에 `allowSyntheticToolResults` 같은 정책값을 넣어야 해서,
  세션 오픈 직전에 policy를 확정한다.

### 5-4) prewarm + guard 래핑된 SessionManager 오픈

```ts
await prewarmSessionFile(params.sessionFile);
sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), {
  agentId: sessionAgentId,
  sessionKey: params.sessionKey,
  inputProvenance: params.inputProvenance,
  allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
  allowedToolNames,
});
trackSessionManagerAccess(params.sessionFile);
```

핵심 포인트:
- `prewarmSessionFile`: 디스크 I/O/캐시 측면에서 초기 접근 비용 완화
- `guardSessionManager`: 원본 SessionManager에 안전장치 부여
  - 허용되지 않은 툴명/비정상 tool-result 등 transcript 무결성 방어
  - 입력 출처(`inputProvenance`) 정보도 함께 보존
- `trackSessionManagerAccess`: 운영 관측(어떤 세션 파일이 자주 접근되는지)

### 5-5) 런 실행 전 세션 상태 정렬

```ts
await prepareSessionManagerForRun({
  sessionManager,
  sessionFile: params.sessionFile,
  hadSessionFile,
  sessionId: params.sessionId,
  cwd: effectiveWorkspace,
});
```

이 단계의 역할:
- 이전 leaf/branch 포인터나 메타 상태를 현재 런 컨텍스트에 맞게 정렬
- 신규/기존 세션 모두에서 "지금 프롬프트를 시작 가능한 상태"로 보장

### 5-6) 설정 매니저 + 확장 팩토리 준비

```ts
const settingsManager = createPreparedEmbeddedPiSettingsManager({
  cwd: effectiveWorkspace,
  agentDir,
  cfg: params.config,
});

const extensionFactories = buildEmbeddedExtensionFactories({
  cfg: params.config,
  sessionManager,
  provider: params.provider,
  modelId: params.modelId,
  model: params.model,
});
```

핵심:
- `settingsManager`: 에이전트 설정 해석/적용의 중심
- `extensionFactories`: compaction/pruning 같은 런타임 보호 확장을 제공

### 5-7) 필요할 때만 ResourceLoader 생성

```ts
let resourceLoader: DefaultResourceLoader | undefined;
if (extensionFactories.length > 0) {
  resourceLoader = new DefaultResourceLoader({
    cwd: resolvedWorkspace,
    agentDir,
    settingsManager,
    extensionFactories,
  });
  await resourceLoader.reload();
}
```

왜 조건부인가:
- 확장이 없으면 기본 로더로 충분하므로 불필요한 객체/로딩 비용을 피함
- 확장이 있으면 반드시 로더에 등록/리로드해서 safeguard가 실제로 활성화되게 함

### 5-8) 이 블록의 전체 의미

이 섹션은 사실상 **"세션 무결성 부팅 단계"**다.

- 락으로 동시성 제어
- 파일 복구로 디스크 상태 정상화
- 정책 기반 guard로 transcript 오염 방어
- 런타임 준비로 현재 실행에 맞는 상태 정렬
- 확장 로더 활성화로 compaction/pruning 보호 기동

즉, 여기서 안정성을 확보하지 못하면 이후 `createAgentSession`이나 `prompt()` 단계에서
에러가 나거나, 더 나쁘게는 조용히 망가진 세션이 누적될 수 있다.

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

### 어떤 상태를 "깨진 히스토리"라고 보나? (데이터 예시)

아래는 실제로 provider에서 오류를 유발할 수 있는 대표 패턴들이다.

#### 예시 A) `tool_result`가 있는데 대응 `tool_use/toolCall`이 없음

```json
[
  { "role": "user", "content": "파일 읽어줘" },
  {
    "role": "tool",
    "content": [
      { "type": "tool_result", "tool_use_id": "call_abc", "content": "..." }
    ]
  }
]
```

문제:
- 모델 입장에서는 `call_abc`를 호출한 assistant 턴이 없어서 체인이 끊김.

정리 단계:
- `sanitizeSessionHistory(...)`
- 필요 시 `sanitizeToolUseResultPairing(...)`로 짝 맞춤/정리

#### 예시 B) 반대로 `tool_use`는 있는데 결과가 누락됨

```json
[
  {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "call_123", "name": "read", "input": { "path": "a.txt" } }
    ]
  },
  { "role": "assistant", "content": "다음으로 진행할게" }
]
```

문제:
- tool 실행 결과 없이 다음 assistant 턴으로 넘어가면 provider가 role/order 규칙 위반으로 거부할 수 있음.

정리 단계:
- guard/sanitize 단계에서 누락을 보정하거나 잘못된 블록을 제거

#### 예시 C) 제공자 포맷 제약과 맞지 않는 tool call ID

```json
{
  "type": "toolCall",
  "id": "call-with-invalid-format-!!!",
  "name": "read"
}
```

문제:
- 일부 제공자(예: 엄격한 Cloud Code Assist 계열/일부 Mistral 경로)는 ID 포맷을 강제함.

정리 단계:
- `sanitizeSessionHistory(...)` + stream 래퍼에서
  `sanitizeToolCallIdsForCloudCodeAssist(...)` 적용

#### 예시 D) 턴 순서 자체가 비정상 (연속 user/연속 tool 등)

```json
[
  { "role": "user", "content": "A" },
  { "role": "user", "content": "B" },
  { "role": "tool", "content": "..." }
]
```

문제:
- 모델별 role 전이 규칙(assistant→tool→assistant 등)에 어긋남.

정리 단계:
- `validateGeminiTurns(...)`, `validateAnthropicTurns(...)`에서 검증/정돈

#### 예시 E) 히스토리 컷 이후 발생하는 "고아 tool_result"

```json
// 컷 전
assistant(tool_use call_77) -> tool(tool_result call_77)

// limitHistoryTurns 이후 (앞부분 삭제)
tool(tool_result call_77)   // tool_use가 잘려나감
```

문제:
- 트렁케이션 자체는 정상인데, 잘린 결과로 짝이 깨질 수 있음.

정리 단계:
- 코드가 의도적으로 트렁케이션 후
  `sanitizeToolUseResultPairing(truncated)`를 한 번 더 수행함.

### 왜 sanitize → validate → truncate → re-pair 순서인가?

1. **sanitize**: 먼저 구조적 오염 제거
2. **validate**: 제공자 규칙(Gemini/Anthropic 턴 규칙) 확인
3. **truncate**: 토큰/히스토리 한도 맞춤
4. **re-pair**: 자르면서 새로 생긴 orphan(tool_use/tool_result) 재정리

즉, "한 번 정리하면 끝"이 아니라, **트렁케이션이 새 오류를 만들 수 있어서 마지막 재정리 단계가 꼭 필요**한 구조다.

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

## 9) 프롬프트 실행 본체 (상세)

**코드 위치:** `L1346~L1497`

관련 함수:
- `resolvePromptBuildHookResult`
- `applySystemPromptOverrideToSession`
- `pruneProcessedHistoryImages`
- `detectAndLoadPromptImages`
- `summarizeSessionContext`
- `activeSession.prompt`
- `abortable`

### 9-0) 실행 컨텍스트 변수 초기화

```ts
let promptError: unknown = null;
let promptErrorSource: "prompt" | "compaction" | null = null;
const promptStartedAt = Date.now();
let effectivePrompt = params.prompt;
```

포인트:
- 이 블록은 실패를 즉시 throw하지 않고 `promptError`로 보관한 뒤,
  뒤의 compaction/snapshot/후처리까지 진행할 수 있게 설계됨.

### 9-1) before_prompt_build 훅으로 프롬프트/시스템프롬프트 가변 처리

```ts
const hookResult = await resolvePromptBuildHookResult({
  prompt: params.prompt,
  messages: activeSession.messages,
  hookCtx,
  hookRunner,
  legacyBeforeAgentStartResult: params.legacyBeforeAgentStartResult,
});

if (hookResult?.prependContext) {
  effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
}

const legacySystemPrompt =
  typeof hookResult?.systemPrompt === "string" ? hookResult.systemPrompt.trim() : "";
if (legacySystemPrompt) {
  applySystemPromptOverrideToSession(activeSession, legacySystemPrompt);
  systemPromptText = legacySystemPrompt;
}
```

포인트:
- `prependContext`는 user prompt 앞에 동적으로 문맥을 붙임.
- `systemPrompt` override가 오면 **이번 attempt의 시스템 프롬프트를 교체**.
- 즉, 플러그인이 "입력 텍스트"와 "시스템 규칙" 둘 다 개입 가능.

### 9-2) 고아 user 턴 정리 (role 순서 위반 방지)

```ts
const leafEntry = sessionManager.getLeafEntry();
if (leafEntry?.type === "message" && leafEntry.message.role === "user") {
  if (leafEntry.parentId) sessionManager.branch(leafEntry.parentId);
  else sessionManager.resetLeaf();

  const sessionContext = sessionManager.buildSessionContext();
  activeSession.agent.replaceMessages(sessionContext.messages);
}
```

왜 필요하나:
- 마지막 leaf가 `user`면, 지금 새 prompt까지 들어가며 user가 연속될 수 있음.
- provider에 따라 role ordering 오류가 발생하므로, 실행 직전 leaf를 안전한 지점으로 되돌림.

### 9-3) 히스토리 이미지 정리 (idempotent cleanup)

```ts
const didPruneImages = pruneProcessedHistoryImages(activeSession.messages);
if (didPruneImages) {
  activeSession.agent.replaceMessages(activeSession.messages);
}
```

포인트:
- 이미 처리 완료된 과거 이미지 블록이 남아있으면 제거.
- 매 실행 호출해도 안전(idempotent)하도록 설계됨.

### 9-4) 프롬프트 내 이미지 탐지/로딩 + 샌드박스 경계 적용

```ts
const imageResult = await detectAndLoadPromptImages({
  prompt: effectivePrompt,
  workspaceDir: effectiveWorkspace,
  model: params.model,
  existingImages: params.images,
  maxBytes: MAX_IMAGE_BYTES,
  maxDimensionPx: resolveImageSanitizationLimits(params.config).maxDimensionPx,
  workspaceOnly: effectiveFsWorkspaceOnly,
  sandbox:
    sandbox?.enabled && sandbox?.fsBridge
      ? { root: sandbox.workspaceDir, bridge: sandbox.fsBridge }
      : undefined,
});
```

핵심:
- 프롬프트 텍스트에서 이미지 참조를 찾아 실제 입력 payload로 변환.
- 크기/해상도 제한 적용.
- 샌드박스 모드면 파일 접근 루트를 강제해서 경계 밖 참조 차단.

### 9-5) context 진단 로그 + llm_input 훅

```ts
const sessionSummary = summarizeSessionContext(activeSession.messages);
log.debug(`[context-diag] ... historyTextChars=${sessionSummary.totalTextChars} ...`);

if (hookRunner?.hasHooks("llm_input")) {
  hookRunner.runLlmInput({
    runId: params.runId,
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.modelId,
    systemPrompt: systemPromptText,
    prompt: effectivePrompt,
    historyMessages: activeSession.messages,
    imagesCount: imageResult.images.length,
  }, ...).catch(...);
}
```

포인트:
- 실제 호출 직전 컨텍스트 길이/이미지 수 등을 기록해 overflow 분석 가능.
- `llm_input` 훅은 fire-and-forget이라 실행 흐름을 막지 않음.

### 9-6) 실제 모델 호출 (`activeSession.prompt`) + abort 래핑

```ts
if (imageResult.images.length > 0) {
  await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
} else {
  await abortable(activeSession.prompt(effectivePrompt));
}
```

핵심:
- 이미지가 있을 때만 `images` 옵션 전달 (모델 호환성 이슈 예방).
- `abortable(...)`로 감싸서 timeout/외부 abort가 오면 즉시 중단 가능.

### 9-7) 오류 처리 방식 (중요)

```ts
} catch (err) {
  promptError = err;
  promptErrorSource = "prompt";
} finally {
  log.debug(`embedded run prompt end ... durationMs=...`);
}
```

설계 의도:
- 프롬프트 실패를 바로 throw하지 않고 `promptError`로 보관.
- 이후 단계(compaction 대기, snapshot 확보, hook 후처리, 결과 반환)까지 수행해
  관측성과 복구 가능성을 높임.

### 9-8) 이 블록의 실제 실행 순서 요약

1. 훅으로 prompt/systemPrompt 수정
2. 세션 leaf 정리(연속 user turn 방지)
3. 과거 이미지 블록 청소
4. prompt 내 이미지 로딩(+제한/샌드박스 체크)
5. context 진단 로그/llm_input 훅
6. `activeSession.prompt(...)` 실제 호출 (abortable)
7. 실패 시 `promptError` 기록 후 종료 로그

즉, 9번 섹션은 단순 호출이 아니라 **"호출 전 정합성 확보 + 호출 + 호출 실패를 다음 단계로 연결"**하는 실행 중심 블록이다.

---

## 10) Compaction 대기 & 스냅샷 선택 (상세)

**코드 위치:** `L1499~L1566`

관련 함수:
- `waitForCompactionRetry`
- `isRunnerAbortError`
- `shouldFlagCompactionTimeout`
- `appendCacheTtlTimestamp`
- `isCacheTtlEligibleProvider`
- `selectCompactionTimeoutSnapshot`

### 10-1) 왜 프롬프트 직후에 즉시 스냅샷을 뜨나

```ts
const wasCompactingBefore = activeSession.isCompacting;
const snapshot = activeSession.messages.slice();
const wasCompactingAfter = activeSession.isCompacting;
const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
const preCompactionSessionId = activeSession.sessionId;
```

핵심 의도:
- compaction 대기 중 timeout이 나면, 그 시점의 세션 상태가 불안정할 수 있다.
- 그래서 **compaction에 들어가기 전의 깨끗한 후보 스냅샷**을 먼저 확보.

레이스 방지 포인트:
- `isCompacting`를 before/after 두 번 읽어서,
  캡처 중 compaction이 시작된 케이스를 `preCompactionSnapshot = null`로 버린다.

### 10-2) compaction 재시도 대기와 abort 처리

```ts
try {
  await abortable(waitForCompactionRetry());
} catch (err) {
  if (isRunnerAbortError(err)) {
    if (!promptError) {
      promptError = err;
      promptErrorSource = "compaction";
    }
    log.debug(`compaction wait aborted ...`);
  } else {
    throw err;
  }
}
```

핵심:
- compaction/retry 파트도 `abortable(...)`로 감싸서 timeout/외부 abort를 즉시 반영.
- abort 계열 에러는 런 전체 실패로 즉시 던지지 않고 `promptErrorSource="compaction"`로 표식.
- 비-abort 예외는 진짜 이상 상황으로 간주하고 rethrow.

### 10-3) 이번 attempt에서 compaction이 실제로 발생했는지 체크

```ts
const compactionOccurredThisAttempt = getCompactionCount() > 0;
```

의미:
- 뒤에서 cache-ttl 타임스탬프를 넣을지 판단할 때 사용.
- 이미 compaction이 일어난 attempt라면 추가 custom entry 삽입 타이밍에 더 보수적으로 동작.

### 10-4) cache-ttl 타임스탬프를 "compaction 이후"에 넣는 이유

```ts
if (!timedOutDuringCompaction && !compactionOccurredThisAttempt) {
  const shouldTrackCacheTtl =
    params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
    isCacheTtlEligibleProvider(params.provider, params.modelId);

  if (shouldTrackCacheTtl) {
    appendCacheTtlTimestamp(sessionManager, {
      timestamp: Date.now(),
      provider: params.provider,
      modelId: params.modelId,
    });
  }
}
```

핵심 배경:
- 코드 주석대로, 과거엔 프롬프트 전에 타임스탬프를 넣다가 compaction guard를 깨서
  이중 compaction 문제가 있었음.
- 현재는 **prompt + compaction retry 이후**로 옮겨서 안전하게 기록.
- 또한 compaction 도중 timeout이 나면 세션 일관성이 의심되므로 기록 스킵.

### 10-5) 최종 스냅샷 선택 로직

```ts
const snapshotSelection = selectCompactionTimeoutSnapshot({
  timedOutDuringCompaction,
  preCompactionSnapshot,
  preCompactionSessionId,
  currentSnapshot: activeSession.messages.slice(),
  currentSessionId: activeSession.sessionId,
});

messagesSnapshot = snapshotSelection.messagesSnapshot;
sessionIdUsed = snapshotSelection.sessionIdUsed;
```

선택 원리:
- 정상 케이스: 대기 이후 `currentSnapshot` 사용
- compaction timeout 케이스: 가능하면 `preCompactionSnapshot` 우선
- 어떤 스냅샷을 썼는지 `source`를 경고 로그로 남김

왜 중요한가:
- compaction은 메시지 구조를 재배열할 수 있으므로,
  타임아웃 경계에서 잘못 잡으면 assistant/tool 메타가 어긋난 결과를 리턴할 수 있음.

### 10-6) promptError 영속화와 관측 데이터 기록

```ts
if (promptError && promptErrorSource === "prompt" && !compactionOccurredThisAttempt) {
  sessionManager.appendCustomEntry("openclaw:prompt-error", { ... });
}

cacheTrace?.recordStage("session:after", {
  messages: messagesSnapshot,
  note: timedOutDuringCompaction ? "compaction timeout" : promptError ? "prompt error" : undefined,
});
anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);
```

포인트:
- prompt 단계 오류를 세션에 custom entry로 남겨 재현/디버깅 가능성 확보.
- compaction이 일어난 시도에서는 기록 타이밍 충돌을 피하려고 보수적으로 처리.
- 최종 스냅샷 기준으로 trace/usage를 남겨 "실제로 반환된 상태"와 로그를 맞춤.

### 10-7) 이 블록의 실행 순서 요약

1. compaction 직전 후보 스냅샷 캡처 (레이스 체크 포함)
2. `waitForCompactionRetry()` 대기 (abortable)
3. compaction 발생 여부 확인
4. 필요 시 cache-ttl 타임스탬프 기록
5. timeout 여부를 반영해 최종 스냅샷 선택
6. trace/usage/prompt-error 메타 기록

즉 10번은 단순 대기가 아니라,
**compaction 경계의 불안정 구간에서 결과 일관성을 지키기 위한 안정화 블록**이다.

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
