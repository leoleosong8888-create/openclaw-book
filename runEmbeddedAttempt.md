# runEmbeddedAttempt 함수 실행 로직 분석

대상 소스:
- `src/agents/pi-embedded-runner/run/attempt.ts`
- 함수: `runEmbeddedAttempt(params)`

링크:
- https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/run/attempt.ts#L579

---

## 한 줄 요약
`runEmbeddedAttempt`는 **임베디드 에이전트 1회 실행(Attempt)** 을 책임지는 오케스트레이터로,
워크스페이스/샌드박스 준비 → 도구/프롬프트/세션 초기화 → 모델 스트림 파이프라인 보정 → 프롬프트 실행/컴팩션 대기 → 결과 스냅샷/후처리/정리까지 전체 수명을 관리한다.

---

## 1) 실행 시작 & 작업 공간/샌드박스 결정

핵심 흐름:
1. `workspaceDir`를 사용자 경로로 해석하고 디렉터리 생성
2. 세션키 기준으로 샌드박스 컨텍스트 결정(`resolveSandboxContext`)
3. 실제 작업 디렉터리(`effectiveWorkspace`) 결정
   - 샌드박스 RW 허용이면 원본 워크스페이스
   - 제한 모드면 샌드박스 전용 디렉터리
4. `process.chdir(effectiveWorkspace)`로 실행 컨텍스트 고정

의도:
- 파일 접근 경계를 강제하고, 도구 실행/상대경로 해석을 일관되게 유지.

---

## 2) 스킬/부트스트랩/컨텍스트 파일 주입

핵심 흐름:
- 런타임 스킬 엔트리 로드 여부 계산
- 스킬 환경변수 오버라이드 적용 (`applySkillEnvOverrides*`)
- 스킬 프롬프트 생성 (`resolveSkillsPromptForRun`)
- 부트스트랩/컨텍스트 파일 해석 (`resolveBootstrapContextForRun`)
- `BOOTSTRAP.md` 존재 시 “커밋 리마인더” 워크스페이스 노트 주입

의도:
- 실행 단위마다 필요한 정책/문맥/메모 파일을 시스템 프롬프트에 안정적으로 반영.

---

## 3) 에이전트/툴 구성

핵심 흐름:
- 세션별 에이전트 ID 결정 (`resolveSessionAgentIds`)
- FS 정책(`workspaceOnly`) 계산
- 코어 도구 생성 (`createOpenClawCodingTools`) + 구글 제공자 호환 sanitize
- 허용 툴명 집합 생성(`allowedToolNames`) → 이후 툴 호출 정규화에 사용
- 채널(telegram/signal 등) 기능/액션/힌트/리액션 가이드 계산

의도:
- 같은 코드 경로로도 세션/채널/제공자별 제약을 세밀하게 반영.

---

## 4) 시스템 프롬프트 빌드

핵심 흐름:
- 런타임 메타(호스트, OS, 모델, 쉘, 채널 capability 등) 수집
- `buildEmbeddedSystemPrompt`로 최종 시스템 프롬프트 생성
- `buildSystemPromptReport`로 디버깅/감사용 리포트 생성
- 세션에 override 형태로 주입

포인트:
- heartbeat 프롬프트, docs 경로, TTS 힌트, 툴 힌트, 메모 인용 모드까지 결합됨.

---

## 5) 세션 파일 락 + 세션 매니저 초기화

핵심 흐름:
- 세션 파일 write lock 획득 (`acquireSessionWriteLock`)
- 세션 파일 복구(`repairSessionFileIfNeeded`) 및 prewarm
- `SessionManager`를 guard 래핑해 안전장치 적용
- 런타임 준비(`prepareSessionManagerForRun`)
- 필요 시 extension resource loader 생성/리로드

의도:
- 동시성 충돌, 손상 세션, 불완전 tool result 상태를 방어.

---

## 6) Agent 세션 생성 & streamFn 파이프라인 구성

핵심 흐름:
1. `createAgentSession`으로 실제 agent session 생성
2. 제공자별 스트림 함수 선택
   - `ollama`: 네이티브 스트림 함수 사용
   - `openai-responses + openai`: API 키 있으면 WebSocket, 없으면 HTTP fallback
   - 그 외: `streamSimple`
3. OpenAI-compatible Ollama 경로에서는 `num_ctx` 주입 래퍼 적용
4. 추가 파라미터 적용(`applyExtraParamsToAgent`)
5. 캐시 트레이스/Anthropic payload 로거 래핑
6. transcript 정책 기반 방어 래퍼 체인:
   - thinking 블록 제거
   - tool call id sanitize
   - OpenAI reasoning/function-call pair downgrade
   - 툴명 공백 정규화 + tool call id 보정

의도:
- 모델/제공자별 포맷 제약 차이를 런타임에서 흡수해 실패율을 낮춤.

---

## 7) 과거 히스토리 sanitize/검증/트렁케이션

핵심 흐름:
- 세션 히스토리 sanitize
- Gemini/Anthropic 턴 검증
- DM 한도 기반 히스토리 컷
- 컷 이후 tool_use/tool_result 짝 재보정
- 최종 메시지로 세션 교체

의도:
- “히스토리가 이미 깨져있는 상태”를 최대한 복구하고, 모델 입력 형식을 맞춤.

---

## 8) abort/timeout/구독(Subscription) 제어

핵심 흐름:
- 내부 `AbortController`와 외부 `abortSignal`을 연결
- `abortable(promise)` 유틸로 주요 await를 abort 친화적으로 감쌈
- `subscribeEmbeddedPiSession`으로 스트리밍 산출 수집
  - assistant text, tool meta, usage, 메시지툴 전송 결과, cron 추가 결과 등
- 전역 active run 레지스트리에 queue handle 등록
- timeout 타이머에서 강제 중단 + compaction timeout 플래그 처리

의도:
- 긴 실행/재시도/컴팩션 중에도 중단 가능성과 관측 가능성 확보.

---

## 9) 실제 프롬프트 실행

핵심 흐름:
1. `before_prompt_build`(및 레거시 `before_agent_start`) 훅 수행
   - prepend context
   - 시스템 프롬프트 override 가능
2. 연속 user turn 방지(고아 user 메시지 정리)
3. 처리 완료된 히스토리 이미지 정리
4. 프롬프트 내 이미지 탐지/로딩 (`detectAndLoadPromptImages`)
5. `activeSession.prompt(...)` 실행 (이미지 있으면 함께 전달)
6. 오류는 `promptError`로 캡처하고 이후 플로우 유지

의도:
- 실행 직전 플러그인 개입 지점을 제공하면서도, 프롬프트 실패 시 후처리/정리를 계속 수행.

---

## 10) compaction 대기 & 캐시 TTL 처리

핵심 흐름:
- 프롬프트 직후 메시지 스냅샷 선캡처
- `waitForCompactionRetry()` 대기
- 컴팩션 도중 타임아웃 시 pre-compaction snapshot 우선 선택
- cache-ttl 모드면 compaction 안정화 이후 타임스탬프 custom entry 추가

핵심 설계 의도:
- compaction 경계에서 레이스/이중 compaction/불완전 스냅샷 문제를 회피.

---

## 11) 결과 조립 & 훅 후처리

반환값(요지):
- 실행 상태: `aborted`, `timedOut`, `timedOutDuringCompaction`, `promptError`
- 대화 결과: `messagesSnapshot`, `assistantTexts`, `lastAssistant`
- 도구/전송 결과: `toolMetas`, `lastToolError`, 메시지툴 전송 텍스트/미디어/대상, `didSendViaMessagingTool`
- 운영 신호: `attemptUsage`, `compactionCount`, `successfulCronAdds`
- 기타: `systemPromptReport`, `clientToolCall`, CloudCodeAssist 포맷 오류 플래그

그리고 `llm_output`/`agent_end` 훅을 비동기 후처리로 호출.

---

## 12) finally 정리(아주 중요)

항상 실행되는 정리:
- 구독 해제
- active run 레지스트리 해제
- pending tool result flush(Idle 대기 후)
- 세션 dispose
- OpenAI WS 세션 해제
- 세션 락 release
- 스킬 env 복원
- `cwd` 원복

의도:
- 실패/중단/타임아웃에서도 리소스 누수와 세션 오염을 막는 마지막 안전망.

---

## 구조적 관점에서 본 핵심 포인트 5개

1. **오케스트레이션 중심 함수**
   - 단일 비즈니스 로직보다 “실행 수명주기 관리”에 초점.

2. **방어적 래핑 체인**
   - streamFn에 여러 sanitize/compat 래퍼를 계층적으로 적용해 제공자별 실패를 런타임에서 흡수.

3. **세션 무결성 우선**
   - 락, 파일 복구, 히스토리 정리, flush-after-idle로 tool/result 불일치 리스크 최소화.

4. **관측 가능성(Observability) 내장**
   - cache trace, payload logger, usage/compaction 카운트, hook 이벤트로 사후 분석 가능.

5. **컴팩션 경계 처리의 정교함**
   - 타임아웃·레이스 상황에서 snapshot 선택 전략을 분리해 결과 일관성을 지키는 설계.

---

## 결론
`runEmbeddedAttempt`는 OpenClaw 임베디드 러너의 **실질적인 실행 커널**이다.
단순히 “프롬프트 한 번 호출”이 아니라,
- 세션/도구/프롬프트/모델별 호환성
- 중단/타임아웃/컴팩션/히스토리 손상
- 후킹/로깅/운영 신호
를 한 지점에서 통합 제어하는 고신뢰 실행 파이프라인으로 설계되어 있다.
