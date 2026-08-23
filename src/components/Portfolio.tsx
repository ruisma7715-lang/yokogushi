import { useEffect, useMemo, useState } from "react";
import type { AssetSnapshot, CorrelationWindow, History, Shift } from "../types";
import {
  ACCOUNTS,
  CLASSES,
  CLASS_BY_ID,
  NISA_LIFETIME,
  maxDrawdown,
  newHolding,
  portfolioVol,
  yen,
  type AccountId,
  type ClassId,
  type Holding,
} from "../portfolio/model";

const STORE_KEY = "yokogushi-holdings-v1";

export default function Portfolio({
  assets,
  matrix,
  history,
  shifts,
}: {
  assets: AssetSnapshot[];
  matrix: CorrelationWindow;
  history: History;
  shifts: Shift[];
}) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setHoldings(JSON.parse(raw));
    } catch {
      /* 保存が使えない環境でも入力自体はできる */
    }
    setLoaded(true);
  }, []);

  const save = (next: Holding[]) => {
    setHoldings(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* 保存できなくても表示は動く */
    }
  };

  const patch = (key: string, field: Partial<Holding>) =>
    save(holdings.map((h) => (h.key === key ? { ...h, ...field } : h)));

  // 各クラスの変動率。cash は動かないので 0、other は試算対象外。
  const vols = useMemo(() => {
    const v: Record<string, number> = { cash: 0 };
    for (const a of assets) v[a.id] = a.vol;
    return v;
  }, [assets]);

  const total = holdings.reduce((s, h) => s + (h.amount || 0), 0);

  const analysis = useMemo(() => {
    if (total <= 0) return null;

    // クラス別に集計
    const byClass: Record<string, number> = {};
    for (const h of holdings) byClass[h.klass] = (byClass[h.klass] || 0) + (h.amount || 0);

    // 口座別に集計
    const byAccount: Record<string, number> = {};
    for (const h of holdings) byAccount[h.account] = (byAccount[h.account] || 0) + (h.amount || 0);

    // 実質ドル建ての比率（円高で目減りする部分）
    const usdAmount = CLASSES.filter((c) => c.usd).reduce((s, c) => s + (byClass[c.id] || 0), 0);

    // 試算対象（proxyを持つクラス）だけで重みを作り直す
    const excluded = byClass.other || 0;
    const base = total - excluded;

    const weights: Record<string, number> = {};
    if (base > 0) {
      for (const c of CLASSES) {
        if (!c.proxy) continue;
        weights[c.proxy] = (byClass[c.id] || 0) / base;
      }
    }

    const sigma = base > 0 ? portfolioVol(weights, vols, matrix) : 0;
    const naive = Object.keys(weights).reduce((s, id) => s + weights[id] * (vols[id] ?? 0), 0);
    const benefit = naive > 0 ? (1 - sigma / naive) * 100 : 0;
    const dd = base > 0 ? maxDrawdown(weights, history) : null;

    // 1割を別クラスへ動かすと変動率がどうなるか。総当たりで試算する。
    const movable = CLASSES.filter((c) => c.proxy);
    const moves: { from: ClassId; to: ClassId; sigma: number; delta: number }[] = [];
    const step = 0.1;
    for (const from of movable) {
      if ((weights[from.proxy!] ?? 0) < step) continue;
      for (const to of movable) {
        if (to.id === from.id) continue;
        const w = { ...weights };
        w[from.proxy!] -= step;
        w[to.proxy!] = (w[to.proxy!] ?? 0) + step;
        const s = portfolioVol(w, vols, matrix);
        moves.push({ from: from.id, to: to.id, sigma: s, delta: s - sigma });
      }
    }
    moves.sort((a, b) => a.delta - b.delta);

    const shown = CLASSES.filter((c) => (byClass[c.id] || 0) / total > 0.005).sort(
      (a, b) => (byClass[b.id] || 0) - (byClass[a.id] || 0)
    );

    // いま関係が変わりつつある組み合わせのうち、実際に保有しているものだけ
    const relevant = shifts.filter(
      (s) => Math.abs(s.diff) >= 0.3 && ((weights[s.a] ?? 0) > 0.05 || (weights[s.b] ?? 0) > 0.05)
    );

    const nisa = (byAccount.nisa_growth || 0) + (byAccount.nisa_tsumitate || 0);
    const taxed = ACCOUNTS.filter((a) => !a.taxFree).reduce((s, a) => s + (byAccount[a.id] || 0), 0);

    return {
      byClass, byAccount, shown, weights, sigma, naive, benefit, dd,
      moves: moves.slice(0, 3), relevant, usdRatio: usdAmount / total,
      excluded, nisa, taxed,
    };
  }, [holdings, total, vols, matrix, history, shifts]);

  const assetName = (proxy: string) =>
    CLASSES.find((c) => c.proxy === proxy)?.name ?? assets.find((a) => a.id === proxy)?.name ?? proxy;

  if (!loaded) return null;

  return (
    <section className="pf-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">わたしのポートフォリオ</h2>
          <p className="section-sub">
            銘柄ごとに、資産クラスと口座区分を選んで金額を入れてください。
          </p>
        </div>
      </div>

      <p className="pf-privacy">
        入力内容は<strong>このブラウザの中だけに保存</strong>され、どこにも送信されません。
        サーバーを持たない構成なので、運営者からも見ることはできません。
      </p>

      {/* ---------------- 明細 ---------------- */}

      <div className="hold-list">
        <div className="hold-head" aria-hidden="true">
          <span>銘柄名</span>
          <span>資産クラス</span>
          <span>口座</span>
          <span className="right">評価額</span>
          <span />
        </div>

        {holdings.map((h) => (
          <div className="hold-row" key={h.key}>
            <input
              type="text"
              className="h-name"
              placeholder="例: トヨタ / VOO"
              value={h.name}
              onChange={(e) => patch(h.key, { name: e.target.value })}
              aria-label="銘柄名"
            />

            <select
              className="h-class"
              value={h.klass}
              onChange={(e) => patch(h.key, { klass: e.target.value as ClassId })}
              aria-label="資産クラス"
              style={{ borderLeftColor: CLASS_BY_ID[h.klass].color }}
            >
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="h-account"
              value={h.account}
              onChange={(e) => patch(h.key, { account: e.target.value as AccountId })}
              aria-label="口座区分"
            >
              {ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              inputMode="numeric"
              className="h-amount"
              placeholder="0"
              value={h.amount ? h.amount.toLocaleString("ja-JP") : ""}
              onChange={(e) =>
                patch(h.key, { amount: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })
              }
              aria-label="評価額（円）"
            />

            <button
              type="button"
              className="h-del"
              onClick={() => save(holdings.filter((x) => x.key !== h.key))}
              aria-label={`${h.name || "この行"}を削除`}
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" className="hold-add" onClick={() => save([...holdings, newHolding()])}>
          ＋ 銘柄を追加
        </button>

        {holdings.length > 0 && (
          <p className="hold-hint">
            資産クラスは「何と連動して動くか」で選びます。
            {CLASSES.slice(0, 3).map((c) => `${c.name}=${c.hint}`).join(" / ")} など。
          </p>
        )}
      </div>

      {!analysis ? (
        <p className="pf-empty">銘柄を追加して金額を入れると、診断が出ます。概算で構いません。</p>
      ) : (
        <>
          {/* ---------------- 構成 ---------------- */}

          <div className="pf-total">
            合計 <strong>{yen(total)}</strong>
            <span className="pf-count">（{holdings.length}銘柄）</span>
          </div>

          <div className="pf-bar" role="img" aria-label="資産クラス別の構成比">
            {analysis.shown.map((c) => (
              <div
                key={c.id}
                className="pf-seg"
                style={{
                  width: `${((analysis.byClass[c.id] || 0) / total) * 100}%`,
                  background: c.color,
                }}
                title={`${c.name} ${(((analysis.byClass[c.id] || 0) / total) * 100).toFixed(1)}%`}
              />
            ))}
          </div>

          <ul className="pf-legend">
            {analysis.shown.map((c) => (
              <li key={c.id}>
                <span className="pf-dot" style={{ background: c.color }} />
                <span className="pf-lname">{c.name}</span>
                <span className="pf-pct">
                  {(((analysis.byClass[c.id] || 0) / total) * 100).toFixed(1)}%
                </span>
                <span className="pf-amt">{yen(analysis.byClass[c.id] || 0)}</span>
              </li>
            ))}
          </ul>

          {/* ---------------- 指標 ---------------- */}

          <div className="pf-metrics">
            <div className="pf-metric">
              <dt>推定変動率（年率）</dt>
              <dd>{analysis.sigma.toFixed(1)}%</dd>
              <p>1年でこのくらい上下に振れうる、という目安です。</p>
            </div>

            {analysis.dd && (
              <div className="pf-metric">
                <dt>過去1年の最大下落</dt>
                <dd className="warn">{analysis.dd.drop.toFixed(1)}%</dd>
                <p>
                  同じ配分のまま過去をなぞると、{analysis.dd.from} から {analysis.dd.to} にかけて
                  この幅まで下げていました。
                </p>
              </div>
            )}

            <div className="pf-metric">
              <dt>実質ドル建ての比率</dt>
              <dd>{(analysis.usdRatio * 100).toFixed(0)}%</dd>
              <p>
                米国株・金・暗号資産はドル建てです。この割合の分だけ、
                円高になると円換算の評価額が目減りします。
              </p>
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

          {analysis.excluded > 0 && (
            <p className="pf-note-small">
              「債券・その他」{yen(analysis.excluded)}（{((analysis.excluded / total) * 100).toFixed(0)}%）は
              値動きデータを持っていないため、上のリスク試算からは除いています。
            </p>
          )}

          {/* ---------------- 口座 ---------------- */}

          <div className="pf-accounts">
            <h3>口座区分ごとの内訳</h3>
            <table>
              <thead>
                <tr>
                  <th>口座</th>
                  <th className="right">金額</th>
                  <th className="right">比率</th>
                  <th>課税</th>
                </tr>
              </thead>
              <tbody>
                {ACCOUNTS.filter((a) => (analysis.byAccount[a.id] || 0) > 0).map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="right mono">{yen(analysis.byAccount[a.id])}</td>
                    <td className="right mono">
                      {(((analysis.byAccount[a.id] || 0) / total) * 100).toFixed(0)}%
                    </td>
                    <td className={a.taxFree ? "free" : "taxed"}>
                      {a.taxFree ? "非課税" : "約20%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="pf-account-notes">
              {analysis.nisa > 0 && (
                <li>
                  NISA口座の残高は <strong>{yen(analysis.nisa)}</strong>。生涯投資枠 1,800万円に対する
                  目安です（枠の消費は取得価額で数えるため、評価額とはズレます）。
                  {analysis.nisa > NISA_LIFETIME && "評価額が枠を超えているのは、利益が乗っている状態です。"}
                </li>
              )}
              {analysis.taxed > 0 && (
                <li>
                  課税口座に <strong>{yen(analysis.taxed)}</strong> あります。ここで売却して組み替えると、
                  利益の約20%が税金として差し引かれます。配分を変える際は、この差が効きます。
                </li>
              )}
              {(analysis.byAccount.ideco || 0) > 0 && (
                <li>
                  iDeCo の <strong>{yen(analysis.byAccount.ideco)}</strong> は原則60歳まで引き出せません。
                  生活資金として当てにはできない枠です。
                </li>
              )}
            </ul>
          </div>

          {/* ---------------- いまの相場 ---------------- */}

          {(analysis.relevant.length > 0 || analysis.usdRatio > 0.6) && (
            <div className="pf-now">
              <h3>いまの相場との関係</h3>
              <ul>
                {analysis.usdRatio > 0.6 && (
                  <li>
                    資産の <strong>{(analysis.usdRatio * 100).toFixed(0)}%</strong> がドル建てです。
                    銘柄は分かれていても、円高が来れば同時に目減りします。
                    通貨という一点では分散されていない状態です。
                  </li>
                )}
                {analysis.relevant.map((s) => (
                  <li key={`${s.a}-${s.b}`}>
                    <strong>
                      {assetName(s.a)} と {assetName(s.b)}
                    </strong>
                    の関係が、1年の {s.base >= 0 ? "+" : "−"}
                    {Math.abs(s.base).toFixed(2)} から直近30日は {s.now >= 0 ? "+" : "−"}
                    {Math.abs(s.now).toFixed(2)} に変化しています。
                    どちらも保有しているため、
                    {s.diff > 0
                      ? "これまでより値動きが重なりやすくなっています。"
                      : "これまでより打ち消し合いやすくなっています。"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---------------- 試算 ---------------- */}

          {analysis.moves.length > 0 && (
            <div className="pf-sim">
              <h3>資産の1割を動かすと、どうなるか</h3>
              <p className="pf-sim-lead">
                変動率を下げる方向に効く順です。<strong>推奨ではありません。</strong>
                変動率が低いことは、利益が大きいことを意味しません。
                実行するなら、課税口座では税負担も併せて考える必要があります。
              </p>
              <ul className="pf-moves">
                {analysis.moves.map((m) => (
                  <li key={`${m.from}-${m.to}`}>
                    <span className="pf-move-path">
                      {CLASS_BY_ID[m.from].name} → {CLASS_BY_ID[m.to].name}
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
          )}

          <p className="pf-caveat">
            すべて過去の値動きから計算した目安です。将来の成績を示すものではなく、
            特定の売買を勧めるものでもありません。個別銘柄は資産クラスに束ねて計算しているため、
            同じクラス内の銘柄ごとの違いは反映されません。最終的な判断はご自身で行ってください。
          </p>
        </>
      )}
    </section>
  );
}
