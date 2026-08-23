import { useMemo, useState } from "react";
import type { AssetSnapshot, CorrelationWindow } from "../types";

const DOT: Record<string, string> = {
  nikkei: "var(--a-nikkei)",
  sp500: "var(--a-sp500)",
  usdjpy: "var(--a-usdjpy)",
  gold: "var(--a-gold)",
  btc: "var(--a-btc)",
  us10y: "var(--a-us10y)",
};

// 選んだ資産どうしの相関の平均。低いほど、値動きの理由がバラけている＝分散できている。
function averageCorrelation(ids: string[], matrix: CorrelationWindow): number | null {
  const pairs: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const r = matrix[ids[i]]?.[ids[j]];
      if (typeof r === "number") pairs.push(r);
    }
  }
  return pairs.length ? pairs.reduce((s, v) => s + v, 0) / pairs.length : null;
}

function verdict(avg: number) {
  if (avg < 0.1)
    return {
      grade: "A",
      label: "よく分散できています",
      note: "値動きの理由がバラバラなので、どれかが下げても全体は支えられます。",
      cls: "good",
    };
  if (avg < 0.3)
    return {
      grade: "B",
      label: "まずまず分散できています",
      note: "大きな偏りはありません。もう一段下げたいなら、下の候補を検討してください。",
      cls: "good",
    };
  if (avg < 0.5)
    return {
      grade: "C",
      label: "やや偏っています",
      note: "同じ理由で動く資産が混ざっています。下げたときに一緒に下がりやすい構成です。",
      cls: "warn",
    };
  return {
    grade: "D",
    label: "分散できているとは言えません",
    note: "ほとんどが同じ方向に動きます。銘柄数は多くても、実質1つに賭けているのと近い状態です。",
    cls: "bad",
  };
}

export default function Diversification({
  assets,
  matrix,
}: {
  assets: AssetSnapshot[];
  matrix: CorrelationWindow;
}) {
  const [held, setHeld] = useState<Set<string>>(new Set(assets.map((a) => a.id)));

  const ids = useMemo(() => assets.filter((a) => held.has(a.id)).map((a) => a.id), [assets, held]);
  const avg = useMemo(() => averageCorrelation(ids, matrix), [ids, matrix]);

  // 1つ外したとき／1つ足したときに、平均相関がどこまで下がるかを試算する。
  const advice = useMemo(() => {
    if (ids.length < 3 || avg === null) return null;

    let drop: { id: string; next: number } | null = null;
    for (const id of ids) {
      const next = averageCorrelation(ids.filter((x) => x !== id), matrix);
      if (next !== null && (drop === null || next < drop.next)) drop = { id, next };
    }

    let add: { id: string; next: number } | null = null;
    for (const a of assets) {
      if (held.has(a.id)) continue;
      const next = averageCorrelation([...ids, a.id], matrix);
      if (next !== null && (add === null || next < add.next)) add = { id: a.id, next };
    }

    return {
      drop: drop && drop.next < avg - 0.03 ? drop : null,
      add: add && add.next < avg - 0.03 ? add : null,
    };
  }, [ids, avg, matrix, assets, held]);

  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  const toggle = (id: string) =>
    setHeld((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const v = avg === null ? null : verdict(avg);

  return (
    <section className="div-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">あなたの分散スコア</h2>
          <p className="section-sub">
            持っている資産を選ぶと、それらが「同じ理由で動いていないか」を判定します。
          </p>
        </div>
      </div>

      <div className="holdings">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`hold${held.has(a.id) ? " on" : ""}`}
            aria-pressed={held.has(a.id)}
            onClick={() => toggle(a.id)}
          >
            <span className="hold-check" aria-hidden="true">
              {held.has(a.id) ? "✓" : ""}
            </span>
            <span className="hold-dot" style={{ background: DOT[a.id] }} />
            {a.name}
          </button>
        ))}
      </div>

      {ids.length < 2 || avg === null || v === null ? (
        <p className="div-empty">2つ以上を選ぶと判定できます。</p>
      ) : (
        <>
          <div className={`score ${v.cls}`}>
            <div className="score-grade">{v.grade}</div>
            <div className="score-body">
              <p className="score-label">{v.label}</p>
              <p className="score-num">
                選んだ {ids.length} 資産の平均相関は{" "}
                <strong>
                  {avg >= 0 ? "+" : "−"}
                  {Math.abs(avg).toFixed(2)}
                </strong>
              </p>
              <p className="score-note">{v.note}</p>
            </div>
          </div>

          {advice && (advice.drop || advice.add) && (
            <ul className="advice">
              {advice.drop && (
                <li>
                  <strong>{nameOf(advice.drop.id)}</strong> を外すと、平均相関は{" "}
                  <strong>
                    {advice.drop.next >= 0 ? "+" : "−"}
                    {Math.abs(advice.drop.next).toFixed(2)}
                  </strong>{" "}
                  まで下がります。他と最も似た動きをしている資産です。
                </li>
              )}
              {advice.add && (
                <li>
                  <strong>{nameOf(advice.add.id)}</strong> を加えると、平均相関は{" "}
                  <strong>
                    {advice.add.next >= 0 ? "+" : "−"}
                    {Math.abs(advice.add.next).toFixed(2)}
                  </strong>{" "}
                  に下がります。今の組み合わせと違う理由で動く資産です。
                </li>
              )}
            </ul>
          )}

          <p className="div-caveat">
            これは値動きの似かたを測ったものであり、資産の良し悪しや将来の成績を示すものではありません。
            相関は時期によって変わるため、判定も変わります。
          </p>
        </>
      )}
    </section>
  );
}
