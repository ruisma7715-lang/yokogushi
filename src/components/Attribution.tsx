import { useMemo, useState } from "react";
import type { History, Latest } from "../types";
import {
  SAMPLE_TOTAL,
  SAMPLE_WEIGHTS,
  dailyPortfolioReturns,
  factorsForDay,
  factorsForPeriod,
  normality,
  weightsOf,
  type AttributionData,
} from "../portfolio/attribution";
import { CLASSES, currentValue, yen, type Units } from "../portfolio/model";
import { useHoldings } from "../portfolio/useHoldings";

const PERIODS = [
  { key: 21, label: "1ヶ月" },
  { key: 63, label: "3ヶ月" },
  { key: 250, label: "1年" },
] as const;

export default function Attribution({
  latest,
  history,
  data,
}: {
  latest: Latest;
  history: History;
  data: AttributionData;
}) {
  const holdings = useHoldings();
  const [span, setSpan] = useState<number>(63);

  const units: Units = latest.units;

  const indexNow = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, s] of Object.entries(history.series)) out[id] = s[s.length - 1];
    return out;
  }, [history]);

  // 入力がまだなら、一般的な構成を例として使う。
  // 「入力しないと何も見られない」を避けたいので、先に価値を見せる。
  const { weights, total, isSample } = useMemo(() => {
    if (holdings.length === 0) {
      return { weights: SAMPLE_WEIGHTS, total: SAMPLE_TOTAL, isSample: true };
    }
    const byClass: Record<string, number> = {};
    let sum = 0;
    for (const h of holdings) {
      const v = currentValue(h, units, indexNow);
      byClass[h.klass] = (byClass[h.klass] || 0) + v;
      sum += v;
    }
    if (sum <= 0) return { weights: SAMPLE_WEIGHTS, total: SAMPLE_TOTAL, isSample: true };
    return { weights: weightsOf(byClass, sum), total: sum, isSample: false };
  }, [holdings, units, indexNow]);

  const today = useMemo(() => factorsForDay(weights, total, data, 0), [weights, total, data]);
  const series = useMemo(() => dailyPortfolioReturns(weights, data), [weights, data]);

  const todayPct = total > 0 ? (today.totalYen / total) * 100 : 0;
  const judge = normality(todayPct, series);

  const period = useMemo(
    () => factorsForPeriod(weights, total, data, span),
    [weights, total, data, span]
  );

  const best = period[period.length - 1];
  const worst = period[0];

  // 棒の長さをそろえるための基準
  const maxAbs = Math.max(...today.factors.map((f) => Math.abs(f.yen)), 1);
  const maxAbsP = Math.max(...period.map((f) => Math.abs(f.yen)), 1);

  return (
    <section className="attr-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">今日、なぜ増えた・減ったのか</h2>
          <p className="section-sub">
            金額の変化を、原因ごとに分けて表示します。
          </p>
        </div>
      </div>

      {isSample && (
        <p className="attr-sample">
          まだ入力がないので、<strong>よくある構成（500万円）を例</strong>として表示しています。
          下の「わたしのポートフォリオ」に入れると、あなたの金額に変わります。
        </p>
      )}

      <div className="attr-headline">
        <span className="attr-day">{today.dayLabel}</span>
        <p className={`attr-total ${today.totalYen < 0 ? "minus" : "plus"}`}>
          {today.totalYen >= 0 ? "+" : "−"}
          {yen(Math.abs(today.totalYen))}
        </p>
        <span className="attr-pct">
          （{todayPct >= 0 ? "+" : "−"}
          {Math.abs(todayPct).toFixed(2)}%）
        </span>
      </div>

      <ul className="attr-list">
        {today.factors
          .filter((f) => Math.abs(f.yen) >= total * 0.0001)
          .map((f) => (
            <li key={f.id}>
              <span className="attr-name">
                <span className="attr-dot" style={{ background: f.color }} />
                {f.label}
              </span>
              <span className="attr-bar-wrap">
                <span
                  className={`attr-bar ${f.yen < 0 ? "minus" : "plus"}`}
                  style={{ width: `${(Math.abs(f.yen) / maxAbs) * 100}%` }}
                />
              </span>
              <span className={`attr-yen ${f.yen < 0 ? "minus" : "plus"}`}>
                {f.yen >= 0 ? "+" : "−"}
                {yen(Math.abs(f.yen))}
              </span>
            </li>
          ))}
      </ul>

      {judge && (
        <p className={`attr-judge ${judge.tone}`}>
          {judge.text}
        </p>
      )}

      {/* ---------------- 期間の累積 ---------------- */}

      <div className="attr-period">
        <div className="attr-period-head">
          <h3>効いているのは何か</h3>
          <div className="seg" role="group" aria-label="集計期間">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={p.key === span ? "on" : ""}
                aria-pressed={p.key === span}
                onClick={() => setSpan(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {best && worst && best.id !== worst.id && (
          <p className="attr-summary">
            この期間、いちばん助けたのは <strong className="plus">{best.label}</strong>（
            {best.yen >= 0 ? "+" : "−"}
            {yen(Math.abs(best.yen))}）、いちばん足を引っ張ったのは{" "}
            <strong className="minus">{worst.label}</strong>（
            {worst.yen >= 0 ? "+" : "−"}
            {yen(Math.abs(worst.yen))}）でした。
          </p>
        )}

        <ul className="attr-list">
          {period
            .filter((f) => Math.abs(f.yen) >= total * 0.001)
            .map((f) => (
              <li key={f.id}>
                <span className="attr-name">
                  <span className="attr-dot" style={{ background: f.color }} />
                  {f.label}
                </span>
                <span className="attr-bar-wrap">
                  <span
                    className={`attr-bar ${f.yen < 0 ? "minus" : "plus"}`}
                    style={{ width: `${(Math.abs(f.yen) / maxAbsP) * 100}%` }}
                  />
                </span>
                <span className={`attr-yen ${f.yen < 0 ? "minus" : "plus"}`}>
                  {f.yen >= 0 ? "+" : "−"}
                  {yen(Math.abs(f.yen))}
                </span>
              </li>
            ))}
        </ul>

        {worst && worst.id === "fx_effect" && worst.yen < 0 && (
          <p className="attr-insight">
            この期間、あなたを最も減らしたのは値下がりではなく<strong>円高</strong>です。
            外貨で持っている割合が
            {Math.round(
              CLASSES.filter((c) => c.usd).reduce((s, c) => s + (weights[c.id] ?? 0), 0) * 100
            )}
            % あるためで、銘柄を分けても通貨は分かれていません。
          </p>
        )}
      </div>

      <p className="attr-caveat">
        個別の銘柄ではなく、種類ごとの平均的な値動きで計算した概算です。
        あなたが持っている銘柄そのものの値動きとは差が出ます。
      </p>
    </section>
  );
}
