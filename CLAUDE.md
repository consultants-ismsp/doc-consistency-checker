# CLAUDE.md — 문서 정합성 검사기 (Next.js 웹앱)

> 프로젝트 본체가 리포 최상위다(Next.js 앱 = 루트). 동작의 '정답' 스펙은 `docs/`
> (`문서정합성검사기_설계서.md`, `클로드코드_개발프롬프트.md`) 참고.

## 프로젝트
`.docx` 문서 세트의 정합성을 검사하는 **완전 클라이언트사이드 웹앱**.
여러 산출물을 넣으면 **용어 불일치 · 수치 불일치 · 판정/연계/종속관계 모순**을 찾아
대시보드로 "어디가 어긋났는지"만 보여준다. **수정은 하지 않는다(적발만).**

원래 Python 데스크톱 도구였던 것을 웹 네이티브(TypeScript)로 새로 구현한 것이며,
**검사 동작·룰·용어사전·임계값은 기존 Python 구현을 정답으로 동일하게 재현**한다.

## 절대 원칙 (어기지 말 것)
- **역할 분담**: 숫자·연산·논리규칙·종속관계 → 코드. 텍스트 추출·용어 의미비교 → LLM.
  **LLM에 판정(Y/N)·계산·비교를 시키지 않는다.**
- 도구는 **적발만**. 자동수정·충족판정·표준선언 금지.
- 모든 결과(Finding)에 **출처(문서·절·단락·원문)** 부착.
- 엔진은 도메인 무지. 룰·용어사전은 `lib/config.ts`의 외부 데이터로 받는다.
- **완전 클라이언트사이드.** docx 파싱·LLM 호출·비교·리포트가 전부 브라우저에서 동작한다.
  문서를 어떤 서버에도 보내지 않는다. **API routes / server actions 를 문서 처리에 쓰지 않는다.**
- 외부 통신은 **승인 AI API 하나**뿐. 저장 기능 없음(stateless).
- **LLM 공급자 추상화.** OpenAI 호환(Solar/OpenAI/Gemini/사내망) + Claude(강제 tool 호출).
  base_url/model 설정만 바꿔 전환. API 키는 런타임 UI 입력 후 **메모리(state)에만**
  (하드코딩·번들 포함·영속 저장 금지).

## 기술 스택 · 환경 (반드시 준수)
- **Node v18.20.8** 동작. Node 20+ 전용 기능·의존성 금지. `.nvmrc`·`engines` 명시.
- **Next.js 14 + App Router.** rookies2와 동일하게 **런타임 서버로 구동**(`next build` 후 `next start -H 0.0.0.0 -p 3000`). 단 문서 처리용 API route/server action 은 두지 않는다(아래 완전 클라이언트사이드 원칙 유지).
- `next/image` 쓰면 `images.unoptimized: true`.
- docx 파싱: `jszip`로 `word/document.xml` 파싱(단락·표 셀 + 절/단락/표 좌표).
- 런타임 외부 의존성은 `jszip`뿐(+ react/next). devDep `tsx`로 패리티 스크립트 실행.

## 구조 (리포 최상위 = Next.js 앱)
```
lib/
  schema.ts        공통 타입 (Source/ExtractedItem/Finding)
  loader.ts        docx → blocks (jszip + DOMParser, 절/단락/표 좌표)
  extractor.ts     청크·렌더·매핑 (역할별 프롬프트)
  prompts.ts       system + 역할 프롬프트 (Python *.txt 그대로)
  normalize.ts     Model + auto_value_consistency + stoplist + _to_int
  terms.ts         모드 A/B + 약어쌍·disjoint 거짓양성 회피
  rules/           engine + value/cross_ref/subset/dependency
  report.ts        심각도 정렬 + type_label + 단일 HTML export
  pipeline.ts      load→extract→check 오케스트레이션 + runChecksOnly
  llm/             base / openaiCompatible / anthropic / factory
  config.ts        rules·assessment·isms_demo·glossary·settings (정답 데이터)
app/               layout · page (완전 'use client')
components/        Dashboard (대시보드)
scripts/parity.ts  Python 동작 패리티 검증
docs/              설계서·개발프롬프트 (동작 정답 스펙, 참고용)
```

## 코딩 표준
- 교체지점은 추상 인터페이스(`LLMProvider`, `BaseRule`). `Pipeline`이 공급자를 주입받음(전역 상태 금지).
- 모듈=단일책임. 코어 로직(lib/)은 OS·프레임워크 무관 — DOM/fetch는 함수 내부에서만.
- 키는 메모리 state로만 전달. 하드코딩·커밋 금지.
- **주석은 짧고 자연스럽게(주니어 개발자 톤). 과한 추상화·불필요한 설계 금지.**

## 검증 (Python = 정답)
- `npm run parity` 가 ① Python 단위테스트(test_rules/test_auto/test_terms) TS 포팅 전부 +
  ② 실데이터 캐시(`~/DocConsistencyChecker/out/extracted/*.json`)로 `runChecksOnly` 실행을 검증.
  결정적 비교엔진(loader→normalize→terms→rules→report)은 같은 추출 JSON에 대해 Finding이
  Python과 일치해야 한다. 추출(LLM) 단계만 모델 비결정성 존재.
- 룰·용어 동작을 바꾸면 parity를 먼저 통과시키고, 어긋나면 **Python 동작을 정답**으로 맞춘다.

## 명령어
```bash
nvm use            # 18.20.8
npm install
npm run dev        # 개발 서버 (http://localhost:3000)
npm run build      # .next 빌드
npm start          # 런타임 서버 (next start -H 0.0.0.0 -p 3000)
npm run parity     # 동작 패리티 검증
```

## 응답
- 한국어로 답한다.
