import type { AssetSnapshot, Highlights as HighlightsData } from "../types";

// 相場の姿勢を色で分ける。赤系=リスクを取りにいった、青系=逃げた。
const REGIME_CLASS: Record<string, string> = {
  リスクオン: "on",
  リスクオフ: "off",
  全面高: "on",
  全面安: "off",
  方向感なし: "flat",
};

const KIND_LABEL: Record<string, string> = {
  move: "値動き",
  unusual: "異常値",
  shift: "関係の変化",
};

export default function Highlights({
  data,
  assets,
}: {
  data: HighlightsData;
  assets: AssetSnapshot[];
}) {
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  return (
    <section className="hl-section">
      <div className="hl-head">
        <h2 className="section-title">今日わかったこと</h2>
        <span className="hl-auto">データから自動生成</span>
      </div>

      {data.regime && (
        <div className={`regime ${REGIME_CLASS[data.regime.label] ?? "flat"}`}>
          <span className="regime-label">{data.regime.label}</span>
          <span className="regime-detail">{data.regime.detail}</span>
        </div>
      )}

      <ul className="hl-list">
        {data.items.map((item, i) => (
          <li key={i} className={`hl-item ${item.kind}`}>
            <span className="hl-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
            <span className="hl-text">{item.text}</span>
          </li>
        ))}
      </ul>

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
