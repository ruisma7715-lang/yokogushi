import type { AssetSnapshot, Highlights as HighlightsData } from "../types";

// 相場の姿勢を色で分ける。赤系=リスクを取りにいった、青系=逃げた。
const REGIME_CLASS: Record<string, string> = {
  リスクオン: "on",
  リスクオフ: "off",
  全面高: "on",
  全面安: "off",
  方向感なし: "flat",
};

// 3行それぞれが「どの切り口の話か」を示す。毎日同じ並びにならないので、
// 読む側が今日はどこが動いたのかを一目で掴めるようにする。
const KIND_LABEL: Record<string, string> = {
  day: "値動き",
  move: "値動き",
  unusual: "異常値",
  milestone: "節目",
  streak: "連続",
  shift: "関係の変化",
  span: "この1週間",
  calendar: "予定",
  calm: "静けさ",
};

export default function Highlights({
  data,
  assets,
}: {
  data: HighlightsData;
  assets: AssetSnapshot[];
}) {
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  // lead は fetch.mjs が毎回書き出す。古いデータを読んだときのために items も見る。
  const lines = data.lead?.length ? data.lead : data.items;

  return (
    <section className="hl-section">
      <div className="hl-head">
        <h2 className="section-title">今日の3行</h2>
        <span className="hl-auto">データから自動生成 · {data.asOf}</span>
      </div>

      {data.regime && (
        <div className={`regime ${REGIME_CLASS[data.regime.label] ?? "flat"}`}>
          <span className="regime-label">{data.regime.label}</span>
          <span className="regime-detail">{data.regime.detail}</span>
          {/* 株と金を比べる判定なので、全資産の値が揃った日でしか出せない。
              いちばん新しい日付とずれているときは、そう書く。 */}
          {data.regime.asOf && data.regime.asOf !== data.asOf && (
            <span className="regime-asof">{data.regime.asOf} 時点</span>
          )}
        </div>
      )}

      <ol className="lead-list">
        {lines.map((line, i) => (
          <li key={i} className={`lead-item ${line.kind}`}>
            <span className="lead-num">{i + 1}</span>
            <span className="lead-text">{line.text}</span>
            <span className="lead-kind">{KIND_LABEL[line.kind] ?? line.kind}</span>
          </li>
        ))}
      </ol>

      {data.shifts.length > 0 && (
        <details className="shifts">
          <summary>関係が変わった組み合わせ（1年 → 直近30日）</summary>
          <table className="shift-table">
            <thead>
              <tr>
                <th>組み合わせ</th>
                <th className="num">1年</th>
                <th className="num">30日</th>
                <th className="num">変化</th>
              </tr>
            </thead>
            <tbody>
              {data.shifts.map((s) => (
                <tr key={`${s.a}-${s.b}`}>
                  <td>
                    {nameOf(s.a)} × {nameOf(s.b)}
                  </td>
                  <td className="num">{s.base >= 0 ? "+" : "−"}{Math.abs(s.base).toFixed(2)}</td>
                  <td className="num">{s.now >= 0 ? "+" : "−"}{Math.abs(s.now).toFixed(2)}</td>
                  <td className={`num shift-diff ${Math.abs(s.diff) >= 0.3 ? "big" : ""}`}>
                    {s.diff >= 0 ? "+" : "−"}
                    {Math.abs(s.diff).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="shifts-note">
            変化が <strong>0.30</strong> を超えたものは、これまでの前提が崩れている可能性があります。
            相関の「高さ」より、この「変化」のほうが読み物としての価値があります。
          </p>
        </details>
      )}
    </section>
  );
}
