# LangChain 소개

LangChain은 LLM 앱을 빠르게 조립하기 위한 프레임워크입니다.  
핵심은 **모델 호출 + 프롬프트 + 외부 데이터 + 도구 실행**을 일관된 방식으로 연결하는 것입니다.

## 1) LangChain이 하는 일

- LLM 호출을 표준화 (`OpenAI`, `Anthropic`, `Google` 등)
- 프롬프트 템플릿 관리
- 체인(Chain)으로 단계 연결
- 검색(RAG) 구성: 문서 로딩 → 분할 → 임베딩 → 벡터검색
- 툴/에이전트로 함수 호출, API 호출 자동화
- 메모리/상태 관리와 관측(트레이싱)

---

## 2) 전체 구조 (큰 그림)

실무에서 자주 쓰는 구조는 아래와 같습니다.

1. **Input Layer**
   - 사용자 질문, 시스템 지시, 세션 정보
2. **Prompt Layer**
   - `PromptTemplate` / `ChatPromptTemplate`
3. **Model Layer**
   - `ChatOpenAI` 같은 채팅 모델
4. **Orchestration Layer (LCEL)**
   - `prompt | model | parser` 형태로 파이프라인 연결
5. **Knowledge Layer (RAG)**
   - 문서 로더, 텍스트 분할기, 임베딩, 벡터 DB, 리트리버
6. **Tool/Agent Layer**
   - 검색, DB 조회, 사내 API 같은 도구 호출
7. **Observability/Deploy Layer**
   - LangSmith(추적/평가), LangServe(서빙)

---

## 3) 주요 라이브러리

LangChain 생태계는 모듈화되어 있습니다.

- `langchain`
  - 체인, 프롬프트, 핵심 조립 기능
- `langchain-core`
  - Runnable, 메시지, 공통 인터페이스
- `langchain-community`
  - 다양한 커넥터(로더, 벡터스토어, 툴) 통합
- `langchain-openai`
  - OpenAI 모델/임베딩 연동
- `langgraph`
  - 상태 기반 에이전트 워크플로우 (분기, 재시도, 사람개입)
- `langsmith`
  - 트레이싱, 평가, 프롬프트/실행 품질 관리

추가로 많이 함께 쓰는 것:
- 벡터 DB: `FAISS`, `Chroma`, `Pinecone`, `Weaviate`, `Qdrant`
- 문서 로더: PDF/웹/Notion/Confluence 등

---

## 4) 기본 샘플 코드 (Python)

### 4-1. 가장 단순한 체인

```python
# pip install -U langchain langchain-openai
import os
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import StrOutputParser

os.environ["OPENAI_API_KEY"] = "YOUR_API_KEY"

prompt = ChatPromptTemplate.from_template(
    "너는 친절한 개발 도우미야. {topic}를 5줄로 설명해줘."
)

model = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
parser = StrOutputParser()

chain = prompt | model | parser
result = chain.invoke({"topic": "LangChain의 LCEL"})
print(result)
```

### 4-2. 간단한 RAG 예시 (로컬 텍스트 기반)

```python
# pip install -U langchain langchain-openai langchain-community faiss-cpu
import os
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

os.environ["OPENAI_API_KEY"] = "YOUR_API_KEY"

docs = [
    Document(page_content="LangChain은 LLM 앱 오케스트레이션 프레임워크다."),
    Document(page_content="RAG는 Retrieval-Augmented Generation의 약자다."),
    Document(page_content="LCEL은 Runnable 파이프라인 표현 방식이다."),
]

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectorstore = FAISS.from_documents(docs, embeddings)
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

model = ChatOpenAI(model="gpt-4o-mini", temperature=0)
prompt = ChatPromptTemplate.from_template(
    "아래 문맥만 활용해서 질문에 답해줘.\n\n문맥:\n{context}\n\n질문: {question}"
)
parser = StrOutputParser()

question = "LCEL이 뭐야?"
retrieved_docs = retriever.invoke(question)
context = "\n".join([d.page_content for d in retrieved_docs])

chain = prompt | model | parser
answer = chain.invoke({"context": context, "question": question})
print(answer)
```

---

## 5) JavaScript/TypeScript 초간단 샘플

```ts
// npm i langchain @langchain/openai
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.2 });
const prompt = ChatPromptTemplate.fromTemplate(
  "{topic}을(를) 개발자 관점에서 3문장으로 설명해줘."
);

const chain = prompt.pipe(model).pipe(new StringOutputParser());
const res = await chain.invoke({ topic: "LangChain Agent" });
console.log(res);
```

---

## 6) 실무 도입 팁

- 먼저 **체인 기반**으로 시작하고, 에이전트는 나중에 붙이기
- RAG 품질은 모델보다 **문서 분할/검색전략** 영향이 큼
- 운영 단계에서 LangSmith로 트레이스/평가 지표 필수
- 멀티스텝 분기 로직이 많아지면 LangGraph 고려

필요하면 다음 단계로
1) FastAPI로 LangChain API화,  
2) 벡터 DB 연결,  
3) GitHub Actions 배포 템플릿까지 붙여드릴게요.
