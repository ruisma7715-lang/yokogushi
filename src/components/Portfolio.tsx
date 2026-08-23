import { useEffect, useMemo, useState } from "react";
import type { AssetSnapshot, CorrelationWindow, Shift } from "../types";

// 保有できるものだけを対象にする。
// 米10年債利回りは「指標」であって保有資産ではないため、意図的に外している
// （利回りの変動を債券の損益として扱うと計算が誤るため）。
const HOLDABLE = ["nikkei", "sp500", "usdjpy", "gold", "btc"] as const;

const CASH = { id: "cash", name: "現金・預金", vol: 0, color: "var(--ink-3)" };

const COLOR: Record<string, string> = {
  nikkei: "var(--a-nikkei)",
  sp500: "var(--a-sp500)",
  usdjpy: "var(--a-usdjpy)",
  gold: "var(--a-gold)",
  btc: "var(--a-btc)",
  cash: "var(--ink-3)",
};

const STORE_KEY = "yokogushi-portfolio-v1";

type Amounts = Record<string, number>;

const yen = (v: number) =>
  v >= 1e8
    ? `${(v / 1e8).toFixed(2)}億円`
    : v >= 1e4
      ? `${Math.round(v / 1e4).toLocaleString("ja-JP")}万円`
      : `${Math.round(v).toLocaleString("ja-JP")}円`;

// ポートフォリオ全体の変動率。
// 相関を織り込むので、単純な加重平均より必ず小さくなる。その差が分散の効果。
function portfolioVol(
  weights: Record<string, number>,
  vols: Record<string, number>,
  matrix: CorrelationWindow
): number {
  const ids = Object.keys(weights).filter((id) => weights[id] > 0);
  let variance = 0;
  for (const a of ids) {
    for (const b of ids) {
      const rho = a === b ? 1 : (matrix[a]?.[b] ?? 0);
      variance += weights[a] * weights[b] * (vols[a] ?? 0) * (vols[b] ?? 0) * rho;
    }
  }
  return Math.sqrt(Math.max(0, variance));
}

export default function Portfolio({
  assets,
  matrix,
  shifts,
}: {
  assets: AssetSnapshot[];
  matrix: CorrelationWindow;
  shifts: Shift[];
}) {
  const [amounts, setAmounts] = useState<Amounts>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setAmounts(JSON.parse(raw));
    } catch {
      /* 保存が使えない環境でも入力自体はできる */
    }
  }, []);

  const update = (id: string, value: string) => {
    const n = Number(value.replace(/[^0-9]/g, ""));
    const next = { ...amounts, [id]: Number.isFinite(n) ? n : 0 };
    setAmounts(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* 保存できなくても表示は動く */
    }
  };

  const rows = useMemo(() => {
    const list = HOLDABLE.map((id) => {
      const a = assets.find((x) => x.id === id);
      return { id, name: a?.name ?? id, vol: a?.vol ?? 0 };
    });
    return [...list, CASH];
  }, [assets]);

  const total = rows.reduce((s, r) => s + (amounts[r.id] || 0), 0);

  const analysis = useMemo(() => {
    if (total <= 0) return null;

    const weights: Record<string, number> = {};
    const vols: Record<string, number> = {};
    for (const r of rows) {
      weights[r.id] = (amounts[r.id] || 0) / total;
      vols[r.id] = r.vol;
    }

    const sigma = portfolioVol(weights, vols, matrix);
    const naive = rows.reduce((s, r) => s + weights[r.id] * r.vol, 0);
    const benefit = naive > 0 ? (1 - sigma / naive) * 100 : 0;

    // 1割を別の資産に移したら変動率がどうなるかを総当たりで試算する。
    // 「こうすべき」ではなく「こうすると、こうなる」を示すのが目的。
    const moves: { from: string; to: string; sigma: number; delta: number }[] = [];
    const step = 0.1;
    for (const from of rows) {
      if (weights[from.id] < step) continue;
      for (const to of rows) {
        if (to.id === from.id) continue;
        const w = { ...weights };
        w[from.id] -= step;
        w[to.id] += step;
        const s = portfolioVol(w, vols, matrix);
        moves.push({ from: from.id, to: to.id, sigma: s, delta: s - sigma });
      }
    }
    moves.sort((a, b) => a.delta - b.delta);

    const held = rows.filter((r) => weights[r.id] > 0.01).sort((a, b) => weights[b.id] - weights[a.id]);

    // いま関係が変わりつつある組み合わせのうち、実際に保有しているものだけ拾う
    const relevant = shifts.filter(
      (s) => Math.abs(s.diff) >= 0.3 && (weights[s.a] > 0.05 || weights[s.b] > 0.05)
    );

    return { weights, sigma, naive, benefit, moves: moves.slice(0, 3), held, relevant };
  }, [amounts, total, rows, matrix, shifts]);

  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id;

  return (
    <section className="pf-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">わたしのポートフォリオ</h2>
          <p className="section-sub">
            保有額を入れると構成を図にして、いまの相場との関係を診断します。
          </p>
        </div>
      </div>

      <p className="pf-privacy">
        入力した金額は<strong>このブラウザの中だけに保存</strong>され、どこにも送信されません。
        サーバーを持たない構成なので、こちらから見ることもできません。
      </p>

      <div className="pf-inputs">
        {rows.map((r) => (
          <label key={r.id} className="pf-field">
            <span className="pf-dot" style={{ background: COLOR[r.id] }} />
            <span className="pf-name">{r.name}</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={amounts[r.id] ? amounts[r.id].toLocaleString("ja-JP") : ""}
              onChange={(e) => update(r.id, e.target.value)}
              aria-label={`${r.name}の保有額（円）`}
            />
            <span className="pf-unit">円</span>
          </label>
        ))}
      </div>

      {!analysis ? (
        <p className="pf-empty">金額を入れると診断が出ます。おおよその額で構いません。</p>
      ) : (
        <>
          <div className="pf-total">
            合計 <strong>{yen(total)}</strong>
          </div>

          <div className="pf-bar" role="img" aria-label="資産構成の比率">
            {analysis.held.map((r) => (
              <div
                key={r.id}
                className="pf-seg"
                style={{
                  width: `${analysis.weights[r.id] * 100}%`,
                  background: COLOR[r.id],
                }}
                title={`${r.name} ${(analysis.weights[r.id] * 100).toFixed(1)}%`}
              />
            ))}
          </div>

          <ul className="pf-legend">
            {analysis.held.map((r) => (
              <li key={r.id}>
                <span className="pf-dot" style={{ background: COLOR[r.id] }} />
                <span className="pf-lname">{r.name}</span>
                <span className="pf-pct">{(analysis.weights[r.id] * 100).toFixed(1)}%</span>
                <span className="pf-amt">{yen(amounts[r.id] || 0)}</span>
              </li>
            ))}
          </ul>

          <div className="pf-metrics">
            <div className="pf-metric">
              <dt>推定変動率（年率）</dt>
              <dd>{analysis.sigma.toFixed(1)}%</dd>
              <p>1年でこのくらい上下に振れうる、という目安です。</p>
            </div>
            <div className="pf-metric">
              <dt>分散が効いている度合い</dt>
              <dd>{analysis.benefit.toFixed(0)}%</dd>
              <p>
                バラバラに持たなければ {analysis.naive.toFixed(1)}% でした。組み合わせで
                {analysis.benefit.toFixed(0)}% 抑えられています。
              </p>
            </div>
          </div>

          {analysis.held[0] && analysis.weights[analysis.held[0].id] >= 0.4 && (
            <p className="pf-flag">
              <strong>{analysis.held[0].name}</strong> が全体の{" "}
              {(analysis.weights[analysis.held[0].id] * 100).toFixed(0)}%
              を占めています。この資産が動くと、全体がそのまま動く構造です。
            </p>
          )}

          {analysis.relevant.length > 0 && (
            <div className="pf-now">
              <h3>いまの相場との関係</h3>
              <ul>
                {analysis.relevant.map((s) => (
                  <li key={`${s.a}-${s.b}`}>
                    <strong>
                      {nameOf(s.a)} と {nameOf(s.b)}
                    </strong>
                    の関係が、1年の {s.base >= 0 ? "+" : "−"}
                    {Math.abs(s.base).toFixed(2)} から直近30日は {s.now >= 0 ? "+" : "−"}
                    {Math.abs(s.now).toFixed(2)} に変わっています。
                    あなたはこの組み合わせを保有しているため、
                    {s.diff > 0
                      ? "これまでより値動きが重なりやすくなっています。"
                      : "これまでより値動きが打ち消し合いやすくなっています。"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pf-sim">
            <h3>資産を1割動かすと、どうなるか</h3>
            <p className="pf-sim-lead">
              変動率を下げる方向に効く順です。<strong>推奨ではありません。</strong>
              変動率が低いことは、利益が大きいことを意味しません。
            </p>
            <ul className="pf-moves">
              {analysis.moves.map((m) => (
                <li key={`${m.from}-${m.to}`}>
                  <span className="pf-move-path">
                    {nameOf(m.from)} → {nameOf(m.to)}
                  </span>
                  <span className="pf-move-num">
                    {analysis.sigma.toFixed(1)}% → <strong>{m.sigma.toFixed(1)}%</strong>
                    <span className={m.delta <= 0 ? "down" : "up"}>
                      （{m.delta >= 0 ? "+" : "−"}
                      {Math.abs(m.delta).toFixed(1)}pt）
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="pf-caveat">
            すべて過去90日の値動きから計算した目安です。将来の成績を示すものではなく、
            特定の売買を勧めるものでもありません。最終的な判断はご自身で行ってください。
          </p>
        </>
      )}
    </section>
  );
}
