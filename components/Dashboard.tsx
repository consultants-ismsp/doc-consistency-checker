"use client";
import { useMemo, useState } from "react";
import type { Payload, FindingDict } from "../lib/report";

const TL: Record<string, string> = {
  all: "전체",
  term: "용어",
  value: "수치",
  cross_ref: "연계",
  dependency: "종속",
  subset: "부분집합",
  typo: "오타",
};

function locLine(l: FindingDict["locations"][number]): string {
  return `${l.doc} · 절 ${l.section || "-"} · 단락 ${l.para_index}`;
}

export default function Dashboard({ payload }: { payload: Payload }) {
  const F = payload.findings;
  const M = payload.meta;
  const [sev, setSev] = useState<string>("all");
  const [typ, setTyp] = useState<string>("all");

  const count = (pred: (f: FindingDict) => boolean) => F.filter(pred).length;
  const cards: Array<[string, number, string]> = [
    ["전체", F.length, ""],
    ["high", count((f) => f.severity === "high"), "acc-high"],
    ["medium", count((f) => f.severity === "medium"), "acc-medium"],
    ["low", count((f) => f.severity === "low"), "acc-low"],
    ["용어", count((f) => f.type === "term"), ""],
    ["수치", count((f) => f.type === "value"), ""],
    ["연계", count((f) => f.type === "cross_ref"), ""],
    ["종속", count((f) => f.type === "dependency"), ""],
    ["부분집합", count((f) => f.type === "subset"), ""],
    ["오타", count((f) => f.type === "typo"), ""],
  ];

  const shown = useMemo(
    () => F.filter((f) => (sev === "all" || f.severity === sev) && (typ === "all" || f.type === typ)),
    [F, sev, typ]
  );

  const sevs = ["all", "high", "medium", "low"];
  const types = ["all", "term", "value", "cross_ref", "dependency", "subset", "typo"];
  const skipped = M.skipped_rules ?? [];
  const errors = M.errors ?? [];

  return (
    <div>
      <div className="summaryline">
        검사 일시 {M.generated_at || "-"} · 대상 문서 <b>{(M.docs || []).length}</b>개 · 총 위반{" "}
        <b>{F.length}</b>건
      </div>

      <div className="cards">
        {cards.map(([l, n, acc]) => (
          <div className={`card ${acc}`} key={l}>
            <div className="n">{n}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      {/* 검증 커버리지: 미검사(스킵 룰) + 추출 실패 */}
      {(skipped.length > 0 || errors.length > 0) && (
        <div className="panel">
          <h2>검증 커버리지</h2>
          <div className="coverage">
            <span className="k">적용 룰 스킵(검사 불가):</span> {skipped.length}건
            {skipped.map(([id, why], i) => (
              <div className="skipline" key={i}>
                · {id} — {why}
              </div>
            ))}
            {errors.length > 0 && (
              <>
                <div style={{ marginTop: 8 }}>
                  <span className="k">추출 실패 문서:</span> {errors.length}건
                </div>
                {errors.map((e, i) => (
                  <div className="errline" key={i}>
                    · {e.file} — {e.error}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <div className="filters">
        {sevs.map((s) => (
          <button key={s} className={s === sev ? "on" : ""} onClick={() => setSev(s)}>
            {s === "all" ? "심각도 전체" : s}
          </button>
        ))}
      </div>
      <div className="filters">
        {types.map((t) => (
          <button key={t} className={t === typ ? "on" : ""} onClick={() => setTyp(t)}>
            {t === "all" ? "유형 전체" : TL[t]}
          </button>
        ))}
      </div>

      <div>
        {shown.length === 0 ? (
          <div className="empty">✓ 해당 조건의 위반이 없습니다</div>
        ) : (
          shown.map((f, i) => (
            <div className={`f ${f.severity}`} key={`${f.rule_id}-${i}`}>
              <div className="head">
                <span className="badge b-type">{f.type_label}</span>
                <span className={`badge b-${f.severity}`}>{f.severity}</span>
                <span className="rid">{f.rule_id}</span>
              </div>
              <div className="msg">{f.message}</div>
              <div className="ev">
                기대: {f.expected}
                {"\n"}실제: {f.actual}
              </div>
              {(f.locations || []).map((l, j) => (
                <div className="loc" key={j}>
                  <div className="docline">📄 {locLine(l)}</div>
                  {l.snippet ? <div className="snip">{l.snippet}</div> : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
