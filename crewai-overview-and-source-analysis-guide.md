# CrewAI 소스 분석 가이드 (소개/주요기능/필요 라이브러리/예시)

이 문서는 CrewAI 기능 소스를 분석하려는 개발자를 위한 빠른 출발점입니다.

---

## 1) CrewAI란?

CrewAI는 **멀티 에이전트 워크플로우**를 설계/실행/관측하기 위한 프레임워크입니다.

핵심 개념:
- **Agent**: 역할/도구/메모리를 가진 실행 주체
- **Task**: 에이전트가 수행할 작업 단위
- **Crew**: 여러 에이전트/작업을 묶는 실행 단위
- **Flow**: 이벤트/라우팅/상태 전이 중심 오케스트레이션 레이어

공식 문서 포지션: “agents, crews, flows를 프로덕션 수준으로 운영”

---

## 2) 주요 기능 (분석 포인트 포함)

### A. Agent 구성
- 역할(role), 목표(goal), 백스토리 등 설정
- 툴(tool) 연결
- 구조화 출력(Pydantic) 지원

**소스 분석 포인트**
- 에이전트 생성 경로
- 툴 호출 스키마 검증
- 모델 호출 실패 시 재시도/예외 처리

### B. Task & Process
- 순차/계층/하이브리드 프로세스 구성
- guardrail/callback/human-in-the-loop 패턴

**소스 분석 포인트**
- Task 상태머신
- 실패 전파 방식
- 재시도 정책/timeout

### C. Flow 오케스트레이션
- start/listen/router 형태의 이벤트 기반 흐름
- 장기 실행 재개(resume) 시나리오

**소스 분석 포인트**
- 라우팅 분기 규칙
- 상태 저장/복구 경계
- idempotency(중복 실행 안전성)

### D. Knowledge/Memory
- 프로젝트 지식(knowledge/) 연결
- 에이전트 문맥 주입

**소스 분석 포인트**
- 검색/주입 시점
- 컨텍스트 팽창 제어
- 캐시 정책

### E. 모니터링/운영
- 실행 시간, 에이전트 선택, 도구 사용량 등 관측
- 엔터프라이즈에서 KPI/ROI 연동

**소스 분석 포인트**
- telemetry 이벤트 구조
- trace/span 경계
- 비용 계산 로직

---

## 3) 개발자가 준비할 라이브러리/환경

## 필수
- Python: `>=3.10, <3.14`
- CrewAI CLI (`uv tool install crewai`)
- 모델 API 키(.env)

## 자주 쓰는 패키지
- `crewai` (핵심)
- `pydantic` (구조화 출력/스키마)
- 사용 모델 SDK (예: openai 계열)

## 프로젝트 기본 구조(문서 기준)

```text
my_project/
├── knowledge/
├── .env
├── src/my_project/
│   ├── main.py
│   ├── crew.py
│   ├── tools/
│   └── config/
│       ├── agents.yaml
│       └── tasks.yaml
```

---

## 4) 최소 사용 예시

### 4-1) 설치/초기화

```bash
uv tool install crewai
crewai create crew demo_project
cd demo_project
crewai install
crewai run
```

### 4-2) 에이전트 + 태스크 개념 예시

```yaml
# agents.yaml (개념 예시)
researcher:
  role: "리서치 에이전트"
  goal: "주제 관련 핵심 정보 수집"

writer:
  role: "작성 에이전트"
  goal: "리서치 결과를 보고서로 작성"
```

```yaml
# tasks.yaml (개념 예시)
collect_facts:
  agent: researcher
  description: "주제 핵심 사실 5개 수집"

write_report:
  agent: writer
  description: "핵심 사실 기반 요약 보고서 작성"
```

---

## 5) CrewAI 기능 소스 분석 체크리스트

1. **엔트리포인트**
- `main.py` → `crew.py` → task 실행 루프 확인

2. **에이전트 생성 경로**
- YAML 파싱 → 객체 생성 → 런타임 주입

3. **도구 실행 경계**
- 입력 스키마 검증
- 예외 발생 시 fallback

4. **프로세스 오케스트레이션**
- 순차/분기/병렬 처리 여부
- 상태 저장 시점

5. **관측성**
- 로그/메트릭/추적 이벤트 필드 정리

6. **비용/성능**
- 호출 횟수, 토큰, 지연시간 집계
- hot path 최적화 지점

7. **안전성**
- 프롬프트 인젝션/권한/민감정보 노출 방지

---

## 6) 실무 팁

- 먼저 단일 에이전트로 정확도 확보 후 멀티에이전트 확장
- Task 경계를 작게 잡아 디버깅 가능성 확보
- 모니터링 없이 확장하면 품질/비용 통제가 어려움
- ROI 보고를 위해 “사람 작업 대비 절감 시간” 지표를 반드시 수집

---

## 7) 참고 링크

- Docs: https://docs.crewai.com/
- GitHub: https://github.com/crewAIInc/crewAI
- 사례: https://crewai.com/case-studies/
