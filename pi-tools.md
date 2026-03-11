# agents/pi-tools.ts 코드 정리 (주요 함수 + 역할)

원문:
- https://github.com/openclaw/openclaw/blob/main/src/agents/pi-tools.ts

이 파일은 OpenClaw에서 **에이전트가 사용할 툴 목록을 구성하고 정책으로 필터링하는 핵심 파일**입니다.

---

## 1) 핵심 역할 한 줄

`createOpenClawCodingTools()`가 중심이며,
- 실행 환경(샌드박스/워크스페이스)
- 모델/메시지 제공자 제약
- 보안/권한 정책
- 스키마 정규화
를 모두 적용해 최종 툴 리스트를 반환합니다.

---

## 2) 주요 함수 요약

## A. `isOpenAIProvider(provider)`
OpenAI 계열인지 빠르게 판별합니다.

```ts
function isOpenAIProvider(provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "openai" || normalized === "openai-codex";
}
```

**왜 중요?**
- `apply_patch` 같은 특정 툴을 모델 제공자 기준으로 허용/차단할 때 사용됩니다.

---

## B. `applyMessageProviderToolPolicy(tools, messageProvider)`
메시지 채널별 툴 제한을 적용합니다.

```ts
const TOOL_DENY_BY_MESSAGE_PROVIDER = {
  voice: ["tts"],
};
...
return tools.filter((tool) => !deniedSet.has(tool.name));
```

**왜 중요?**
- 예: voice 채널에서는 tts 중복 호출 같은 충돌을 막아줌.

---

## C. `applyModelProviderToolPolicy(tools, {modelProvider, modelId})`
모델 제공자별 충돌 툴을 제거합니다.

```ts
if (!isXaiProvider(params?.modelProvider, params?.modelId)) return tools;
return tools.filter((tool) => !TOOL_DENY_FOR_XAI_PROVIDERS.has(tool.name));
```

**왜 중요?**
- xAI/Grok처럼 네이티브 web_search를 가진 경우 중복 툴 이름 충돌 방지.

---

## D. `resolveExecConfig({cfg, agentId})`
전역 config + agent별 config를 병합해 exec 기본값을 만듭니다.

```ts
const globalExec = cfg?.tools?.exec;
const agentExec = cfg && agentId ? resolveAgentConfig(cfg, agentId)?.tools?.exec : undefined;
return {
  host: agentExec?.host ?? globalExec?.host,
  security: agentExec?.security ?? globalExec?.security,
  ...
};
```

**왜 중요?**
- 실행 호스트/보안/timeout/safebin 정책이 여기서 최종 확정됩니다.

---

## E. `resolveToolLoopDetectionConfig({cfg, agentId})`
툴 루프 감지 정책(전역+에이전트)을 병합합니다.

```ts
return {
  ...global,
  ...agent,
  detectors: {
    ...global.detectors,
    ...agent.detectors,
  },
};
```

**왜 중요?**
- 같은 툴 호출이 반복되는 비정상 루프를 탐지/차단하는 기반.

---

## F. `createOpenClawCodingTools(options)` (핵심)
실질적으로 이 파일의 메인 엔진입니다.

### 내부에서 하는 일
1. 정책 로드
- profile/global/agent/group/subagent 정책 수집

2. 기본 툴 구성
- read/write/edit, exec/process, channel tools, openclaw tools 조립

3. 샌드박스/워크스페이스 제약 적용
- sandbox root/bridge, workspaceOnly guard 적용

4. 특수 실행 모드(memory flush) 제한
- write/read만 허용하고 append-only write 래핑

5. 메시지 제공자/모델 제공자/소유자 권한 필터
- channel/model/owner 정책으로 툴 제거

6. 정책 파이프라인 적용
- `applyToolPolicyPipeline(...)`

7. 스키마 정규화 + 훅 래핑
- provider별 스키마 정리
- before-tool-call hook
- abort signal 연결

### 핵심 스니핏

```ts
const normalized = subagentFiltered.map((tool) =>
  normalizeToolParameters(tool, {
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  }),
);
const withHooks = normalized.map((tool) =>
  wrapToolWithBeforeToolCallHook(tool, { ... }),
);
const withAbort = options?.abortSignal
  ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
  : withHooks;
return withAbort;
```

**왜 중요?**
- "툴 목록"이 아니라 **정책 적용된 실행 가능한 툴 런타임**을 반환합니다.

---

## 3) 파일을 읽을 때 보는 순서 (추천)

1. 상단 상수/정책 맵(`TOOL_DENY_*`)
2. provider/message 기반 필터 함수
3. exec/loop config 병합 함수
4. `createOpenClawCodingTools()` 본문
   - base tools 구성
   - 정책 파이프라인
   - 최종 normalize/hook/abort

---

## 4) 디버깅 포인트

- 특정 툴이 안 보일 때:
  - message provider 정책
  - model provider 정책
  - owner-only 정책
  - group/subagent 정책
  - sandbox tools.allow

- 툴 호출이 실패할 때:
  - 스키마 정규화(`normalizeToolParameters`) 결과
  - Claude/Gemini provider 호환 패치
  - before-tool-call hook/abort signal 개입 여부

---

## 5) 결론

`agents/pi-tools.ts`는 OpenClaw의
**툴 조립기 + 정책 게이트 + 실행 안전장치** 역할을 동시에 수행합니다.

실무적으로는
> "왜 이 툴이 보이거나 안 보이는가"
를 설명하는 첫 번째 파일입니다.
