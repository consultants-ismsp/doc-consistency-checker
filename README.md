# 문서 정합성 검사기

ISMS-P 보안컨설팅 산출물(`.docx`·`.xlsx`) 여러 개를 올리면 문서들 사이의
**용어 불일치 · 수치 불일치 · 판정/연계/종속관계 모순**을 찾아 "어디가 어긋났는지"만
대시보드로 보여주는 **Next.js 14 + React 18 + TypeScript** 웹앱입니다.
원래 Python 데스크톱 도구였던 것을 웹 네이티브로 새로 구현했습니다.

> **처리 원칙**: docx 파싱·LLM 호출·비교·리포트가 **전부 브라우저(클라이언트)**에서 일어나고,
> 문서는 어떤 서버에도 가지 않습니다. **DB·로그인·저장 없음**(stateless), 문서 처리용 API route/server action 없음.
> 도구는 **적발만** 합니다 — 자동수정·표준선언·충족판정을 하지 않습니다. **표준 결정은 사람의 몫**입니다.
> **역할 경계**: 숫자·연산·논리·종속관계는 **코드**가, 텍스트 추출·용어 의미비교는 **LLM**이 합니다. LLM에 판정(Y/N)·계산·비교를 시키지 않습니다.

## 주요 기능

발표자료(7.3) 6대 기능과 동일합니다.

| # | 기능 | 내용 |
|---|---|---|
| 01 | 수치 검산 | 문서 내 합계·구성요소 자동 계산, 산식 위반 즉시 적발 (예: 노출 위험 217 = 99+117+1, 전체 399 = 339+60) |
| 02 | 문서간 수치 일치 | 동일 수치를 문서 간 교차 대조, 문서마다 값이 다르면 적발 (예: 전체 점검항목 수 — 수행계획서↔수준평가보고서) |
| 03 | 자동 수치 비교 | 동일 항목명이 2개 이상 문서에 나오면 값 대조 — 사전 규칙 없이 값 분기 적발, 일반 집계어 단독 라벨 제외 |
| 04 | 용어 정합 | 모드 A(자동) 동일 개념 다른 표현 적발 + 모드 B(사전) 표준어 외 변형 적발 (예: 어플리케이션 → 애플리케이션) |
| 05 | 통제항목 추적·누락 | 산출물 흐름 부분집합 검증 — 취약(N) 항목의 이행과제 누락, 미평가 항목·미등록 자산 적발 |
| 06 | 판정 종속 모순 | 구조적(자동) 상위 미흡인데 하위 양호 모순 + 의미적(수기) 논리관계 위반 적발 |

> 역할 경계(위 "처리 원칙")대로 — 수치·구조 검사(01·02·03·05, 06 구조적)는 **코드**가, 용어 표준 점검(04 모드 B)은 **LLM**이, 의미적 종속(06)은 **사람**이 적발합니다.

- 모든 결과(Finding)에 **출처(문서·절·단락·원문)**가 붙습니다.
- 비교는 **해당 항목을 가진 문서가 2개 이상**일 때 가진 것끼리만 합니다(1개면 안 함).
- 결과는 **대시보드 HTML · PDF · 추출 JSON**으로 내려받을 수 있습니다.
- 엔진은 도메인 무지 — 룰·용어사전·임계값은 `lib/config.ts`의 외부 데이터로 받습니다.

## 스택 / 버전

| 항목 | 버전 |
|---|---|
| Node | **18.20.8** (`.nvmrc`, `engines` 명시 — Node 20+ 전용 의존성 없음) |
| Next.js | 14.2 (App Router) |
| React | 18.3 |
| TypeScript | 5.4 |
| docx/xlsx 파서 | jszip + DOMParser (런타임 외부 의존성은 jszip뿐) |
| 리포트 내보내기 | 단일 HTML · PDF(jspdf + html2canvas) |
| LLM | OpenAI 호환(Solar/OpenAI/Gemini/OpenRouter/사내망) + Claude(강제 tool 호출) |
| 포트 | 3000 |

앱 버전: `1.0.0`

## 환경변수 / AI 키

챗봇 레포(`.env`에 키 보관)와 달리, 이 앱은 **키를 화면에서 직접 입력**합니다.

- API 키는 **브라우저 메모리(state)에만** 보관됩니다 — 하드코딩·번들 포함·영속 저장 안 함, `.env`·DB 없음.
- 추출·점검 요청은 브라우저에서 **승인 AI API로 직접** 나갑니다(서버 중계 없음). 문서는 서버로 가지 않습니다.
- 공급자는 `base_url`/`model` 설정만 바꿔 전환합니다. 인증은 **API 키(Bearer / x-api-key)** 한 가지입니다.

```
공급자: claude · openrouter · solar · openai · gemini · custom(사내망/커스텀, OpenAI 호환)
키 입력: 가동 화면에서 직접 입력 (메모리에만)
```

## 셋업 & 실행

```bash
nvm use            # 18.20.8
npm install

npm run dev        # 개발 서버  → http://localhost:3000
npm run build      # 프로덕션 빌드(.next)
npm start          # 프로덕션 실행 → next start -H 0.0.0.0 -p 3000 (먼저 build 필요)
npm run parity     # ★ 동작 패리티 검증 (Python = 정답)
```

### 같은 사내망의 다른 PC에서 접속

1. 서버 PC의 LAN IP 확인: `ipconfig getifaddr en0` (macOS)
2. 다른 PC 브라우저에서 `http://<서버IP>:3000` 접속
3. 첫 실행 시 방화벽이 "들어오는 연결 허용?"을 물으면 **허용**

## 프로젝트 구조

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
  config.ts        rules·assessment·glossary·settings (정답 데이터)
app/               layout · page (완전 'use client')
components/        Dashboard (대시보드)
scripts/parity.ts  Python 동작 패리티 검증
docs/              설계서·개발프롬프트 (동작 정답 스펙, 참고용)
```

## 동작 흐름

```
① 산출물 업로드(.docx·.xlsx 2개 이상 + AI 키, 고객사명 옵션)
      → ② 추출(LLM, 문서별 순차) — 원문 그대로 항목 뽑기
            → ③ 검사(코드) — 용어·수치·연계·종속·회사명 정합 비교
                  → ④ 대시보드 — Finding(출처 부착) + HTML/PDF/JSON 내보내기
```

## 패리티 검증 (Python = 정답)

`npm run parity` 가 두 가지를 확인합니다.

1. **단위테스트 포팅** — Python `test_rules.py·test_auto.py·test_terms.py` 의 모든 케이스를 TS 엔진으로 재현해 동일 결과 단정.
2. **실데이터** — Python 추출 캐시(`~/DocConsistencyChecker/out/extracted/*.json`)를 읽어 `runChecksOnly`(= Python `rebuild_from_cache.py`) 실행 → 동일하게 적발(`term-split:발주기관` 1건)·스킵 0건 확인.

> 결정적 비교 엔진(loader→normalize→terms→rules→report)은 같은 추출 JSON에 대해 Finding이 Python과 일치해야 합니다.
> 추출(LLM) 단계만 모델 비결정성이 있습니다. 룰·용어 동작을 바꾸면 **parity를 먼저 통과**시키고, 어긋나면 Python 동작을 정답으로 맞춥니다.

현재 상태: **38 pass, 0 fail**.

## 보안

- docx·xlsx 파싱과 LLM 호출이 브라우저에서만 일어나 **문서가 서버로 전송되지 않습니다**(네트워크 탭에서 확인 가능).
- 외부 통신은 **승인 AI API 하나**뿐. 저장 기능 없음(stateless).
- API 키는 메모리에만 두며 번들·요청 로그에 남기지 않습니다.
- IP 제한·접속 인증·HTTPS가 필요하면 앞단에 리버스 프록시(Caddy/nginx)를 두는 것을 권장합니다.

## 검증 포인트

- 문서가 1개거나 키가 없으면 가동이 막히고 안내되는지(문서 2개 이상 + 키 필요).
- 파일 업로드·추출 시 **네트워크 탭에서 문서가 서버로 안 올라가는지**(브라우저 파싱·직접 호출 확인).
- 회사명(수행사 고정 + 고객사 입력)이 문서마다 다르게 적히면 `term-split`으로 적발되는지.
- 모든 Finding에 출처(문서·절·단락·원문)가 붙는지.
- `npm run parity` 38 pass / 0 fail, `npm run build` 통과.
