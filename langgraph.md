# LangGraph 소개

LangGraph는 **상태(state) 기반으로 LLM 워크플로우를 설계**하는 프레임워크입니다.  
LangChain이 체인 중심이라면, LangGraph는 **그래프(노드/엣지) 중심**으로 분기·반복·재시도를 다루기 좋습니다.

## 1) 왜 LangGraph를 쓰나?

복잡한 에이전트 흐름은 보통 이런 문제가 생깁니다.

- 단계가 많아지면서 분기 로직이 꼬임
- 실패 시 어디서 재시도할지 애매함
- 사람이 중간 승인(Human-in-the-loop)해야 하는 구간 필요
- 실행 이력/상태를 지속해서 관리해야 함

LangGraph는 이를 위해 아래를 제공합니다.

- **StateGraph**: 상태를 중심으로 노드 연결
- **조건부 라우팅**: 결과에 따라 다음 노드 결정
- **순환(loop)**: 목표 달성까지 반복 실행
- **체크포인팅**: 중단/복구 및 상태 저장
- **LangChain 호환**: 기존 모델/프롬프트/툴 재사용 가능

---

## 2) 핵심 개념

### State
워크플로우 전체에서 공유하는 데이터 컨테이너입니다.

예: 사용자 질문, 중간 추론 결과, 툴 실행 결과, 최종 답변

### Node
State를 입력받아 State를 갱신하는 함수입니다.

예: `plan`, `retrieve`, `tool_call`, `finalize`

### Edge
노드 간 연결입니다.

- 일반 엣지: 항상 지정 노드로 이동
- 조건부 엣지: 상태값에 따라 분기

### START / END
그래프의 시작점과 종료점입니다.

---

## 3) 전형적인 구조

실무에서 자주 보는 패턴:

1. **입력 정규화**
2. **계획 수립(Planner)**
3. **도구/검색 실행(Executor)**
4. **검증(Verifier)**
5. **조건 분기**
   - 통과: 종료
   - 실패: 보완 후 재시도 루프

즉, “한 번에 답”보다 **점진적 개선 루프**를 만들 때 강합니다.

---

## 4) 기본 샘플 코드 (Python)

```python
# pip install -U langgraph langchain langchain-openai
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI


class MyState(TypedDict, total=False):
    question: str
    draft: str
    quality: str


llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


def draft_node(state: MyState) -> MyState:
    q = state["question"]
    res = llm.invoke(f"질문에 간단히 답해줘: {q}")
    return {"draft": res.content}


def review_node(state: MyState) -> MyState:
    text = state["draft"]
    # 매우 단순한 예시 규칙
    quality = "good" if len(text) > 30 else "retry"
    return {"quality": quality}


def improve_node(state: MyState) -> MyState:
    q = state["question"]
    old = state["draft"]
    res = llm.invoke(
        f"기존 답변을 더 구체적으로 개선해줘.\n질문: {q}\n기존답: {old}"
    )
    return {"draft": res.content}


def route_after_review(state: MyState) -> str:
    return "end" if state.get("quality") == "good" else "improve"


builder = StateGraph(MyState)
builder.add_node("draft", draft_node)
builder.add_node("review", review_node)
builder.add_node("improve", improve_node)

builder.add_edge(START, "draft")
builder.add_edge("draft", "review")

builder.add_conditional_edges(
    "review",
    route_after_review,
    {
        "end": END,
        "improve": "improve",
    },
)

builder.add_edge("improve", "review")

graph = builder.compile()

result = graph.invoke({"question": "LangGraph를 언제 쓰면 좋아?"})
print(result)
```

---

## 5) LangChain vs LangGraph (요약)

- **LangChain**: 선형/단순 파이프라인 구성에 빠름
- **LangGraph**: 분기/루프/검증/복구가 필요한 복잡 플로우에 강함

간단한 챗봇/요약기는 LangChain만으로 충분하고,  
멀티스텝 에이전트(도구 호출 + 검증 + 재시도)는 LangGraph가 훨씬 안정적입니다.

---

## 6) 실무 팁

- 처음부터 거대한 그래프를 만들지 말고, 3~4개 노드로 시작
- 실패 루프는 최대 반복 횟수 제한 필수
- 각 노드 입출력(State 필드)을 명확히 정의
- 추적/평가는 LangSmith와 함께 사용하면 운영이 쉬워짐

원하면 다음 단계로
- Human-in-the-loop 승인 노드,
- 체크포인트 저장,
- 다중 툴 라우팅 예제까지 이어서 추가할 수 있습니다.
