import { useEffect, useMemo, useState } from "react";
import type { AssetSnapshot, CorrelationWindow, History, Shift } from "../types";
import {
  ACCOUNTS,
  ACCOUNT_BY_ID,
  CLASSES,
  CLASS_BY_ID,
  SCENARIOS,
  TAX_LABEL,
  applyScenario,
  maxDrawdown,
  newHolding,
  parseHoldingsText,
  portfolioVol,
  taxOf,
  yen,
  type AccountId,
  type ClassId,
  type Holding,
  type TaxKind,
} from "../portfolio/model";

const STORE_KEY = "yokogushi-holdings-v1";

/** 分散の効き具合を、数字ではなく言葉で伝える */
function plainVerdict(benefit: number, topShare: number, topName: string) {
  if (topShare >= 0.5)
    return `${topName}だけで全体の${Math.round(topShare * 100)}%を占めています。この1つが下がると、資産全体がほぼそのまま同じだけ下がります。`;
  if (benefit >= 25)
    return "値動きの理由がうまくバラけています。どれかが下がっても、他がある程度支えてくれる形です。";
  if (benefit >= 12)
    return "そこそこバラけています。ただ、似た動きをするものも混ざっています。";
  return "銘柄の数は分かれていても、値動きはほとんど揃っています。分けて持っている効果は小さい状態です。";
}

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
  const [paste, setPaste] = useState("");
  const [pasteAccount, setPasteAccount] = useState<AccountId>("tokutei");
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);

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

  // 資産クラスを変えたとき、その商品では選べない口座が残らないようにする
  const patch = (key: string, field: Partial<Holding>) =>
    save(
      holdings.map((h) => {
        if (h.key !== key) return h;
        const next = { ...h, ...field };
        const allowed = CLASS_BY_ID[next.klass].accounts;
        if (!allowed.includes(next.account)) next.account = allowed[0];
        return next;
      })
    );

  const runImport = () => {
    const rows = parseHoldingsText(paste, pasteAccount);
    if (rows.length === 0) {
      setPasteMsg("読み取れませんでした。銘柄名と評価額が並んだ表を貼ってください。");
      return;
    }
    save([...holdings, ...rows]);
    setPaste("");
    setPasteMsg(`${rows.length}件を取り込みました。資産クラスは自動で推測しています。下の一覧で確認してください。`);
  };

  const vols = useMemo(() => {
    const v: Record<string, number> = { cash: 0 };
    for (const a of assets) v[a.id] = a.vol;
    return v;
  }, [assets]);

  const total = holdings.reduce((s, h) => s + (h.amount || 0), 0);

  const analysis = useMemo(() => {
    if (total <= 0) return null;

    const byClass: Record<string, number> = {};
    const byAccount: Record<string, number> = {};
    const byTax: Record<TaxKind, number> = { separate: 0, aggregate: 0, depends: 0, none: 0 };

    for (const h of holdings) {
      const amt = h.amount || 0;
      byClass[h.klass] = (byClass[h.klass] || 0) + amt;
      byAccount[h.account] = (byAccount[h.account] || 0) + amt;
      byTax[taxOf(h.klass, h.account)] += amt;
    }

    const usdAmount = CLASSES.filter((c) => c.usd).reduce((s, c) => s + (byClass[c.id] || 0), 0);

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
        moves.push({ from: from.id, to: to.id, sigma: portfolioVol(w, vols, matrix), delta: 0 });
      }
    }
    for (const m of moves) m.delta = m.sigma - sigma;
    moves.sort((a, b) => a.delta - b.delta);

    const shown = CLASSES.filter((c) => (byClass[c.id] || 0) / total > 0.005).sort(
      (a, b) => (byClass[b.id] || 0) - (byClass[a.id] || 0)
    );

    const relevant = shifts.filter(
      (s) => Math.abs(s.diff) >= 0.3 && ((weights[s.a] ?? 0) > 0.05 || (weights[s.b] ?? 0) > 0.05)
    );

    const topShare = shown.length ? (byClass[shown[0].id] || 0) / total : 0;

    return {
      byClass, byAccount, byTax, shown, weights, sigma, naive, benefit, dd,
      moves: moves.slice(0, 3), relevant, usdRatio: usdAmount / total, usdAmount,
      excluded, base, topShare,
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
            持っているものを入れると、<strong>どのくらい増減しうるか</strong>を金額で見られます。
          </p>
        </div>
      </div>

      <p className="pf-privacy">
        入力内容は<strong>このブラウザの中だけに保存</strong>され、どこにも送信されません。
        サーバーを持たない作りなので、運営者から見ることもできません。
      </p>

      {/* ---------------- 一括取り込み ---------------- */}

      <details className="pf-import">
        <summary>証券会社の一覧をコピーして、まとめて入れる</summary>
        <p className="pf-import-lead">
          証券会社アプリの「保有商品一覧」を選択してコピーし、そのまま下に貼り付けてください。
          エクセルやCSVからの貼り付けにも対応しています。銘柄名と評価額があれば読み取れます。
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"例\n銘柄名\t評価額\nトヨタ自動車\t520,000\neMAXIS Slim 米国株式(S&P500)\t1,240,000"}
          rows={5}
          aria-label="保有一覧の貼り付け欄"
        />
        <div className="pf-import-row">
          <label>
            この口座として取り込む
            <select
              value={pasteAccount}
              onChange={(e) => setPasteAccount(e.target.value as AccountId)}
            >
              {ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={runImport} disabled={!paste.trim()}>
            取り込む
          </button>
        </div>
        {pasteMsg && <p className="pf-import-msg">{pasteMsg}</p>}
      </details>

      {/* ---------------- 明細 ---------------- */}

      <div className="hold-list">
        <div className="hold-head" aria-hidden="true">
          <span>銘柄名</span>
          <span>種類</span>
          <span>口座</span>
          <span className="right">いまの金額</span>
          <span />
        </div>

        {holdings.map((h) => (
          <div className="hold-row" key={h.key}>
            <input
              type="text"
              className="h-name"
              placeholder="例: トヨタ / eMAXIS Slim 米国株式"
              value={h.name}
              onChange={(e) => patch(h.key, { name: e.target.value })}
              aria-label="銘柄名"
            />

            <select
              className="h-class"
              value={h.klass}
              onChange={(e) => patch(h.key, { klass: e.target.value as ClassId })}
              aria-label="資産の種類"
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
              {CLASS_BY_ID[h.klass].accounts.map((id) => (
                <option key={id} value={id}>
                  {ACCOUNT_BY_ID[id].name}
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
              aria-label="いまの金額（円）"
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
          ＋ 手で1つ追加する
        </button>
      </div>

      {!analysis ? (
        <p className="pf-empty">
          持っているものを入れると、診断が出ます。ざっくりした金額で構いません。
        </p>
      ) : (
        <>
          {/* ---------------- 結論 ---------------- */}

          <div className="pf-verdict">
            <p className="pf-verdict-main">
              {plainVerdict(analysis.benefit, analysis.topShare, analysis.shown[0]?.name ?? "")}
            </p>
          </div>

          <div className="pf-total">
            合計 <strong>{yen(total)}</strong>
            <span className="pf-count">（{holdings.length}件）</span>
          </div>

          <div className="pf-bar" role="img" aria-label="種類ごとの構成比">
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

          {/* ---------------- 指標（金額で示す） ---------------- */}

          <div className="pf-metrics">
            <div className="pf-metric">
              <dt>1年でありうる増減</dt>
              <dd>±{yen((analysis.sigma / 100) * analysis.base)}</dd>
              <p>
                ふつうの年なら、この幅の中で上下すると考えられます（年率{analysis.sigma.toFixed(1)}%）。
                プラスにもマイナスにも同じだけ振れます。
              </p>
            </div>

            {analysis.dd && (
              <div className="pf-metric">
                <dt>実際にあった一番の下げ</dt>
                <dd className="warn">−{yen((Math.abs(analysis.dd.drop) / 100) * analysis.base)}</dd>
                <p>
                  いまと同じ配分で過去1年をなぞると、{analysis.dd.from}から{analysis.dd.to}にかけて
                  これだけ減っていました（{analysis.dd.drop.toFixed(1)}%）。想像ではなく実際の値動きです。
                </p>
              </div>
            )}

            <div className="pf-metric">
              <dt>円高で目減りする部分</dt>
              <dd>{yen(analysis.usdAmount)}</dd>
              <p>
                資産の{(analysis.usdRatio * 100).toFixed(0)}%はドルで持っているのと同じです。
                1円の円高でおよそ{yen(analysis.usdAmount / 158)}減る計算になります。
              </p>
            </div>

            <div className="pf-metric">
              <dt>分けて持てている度合い</dt>
              <dd>{analysis.benefit.toFixed(0)}%</dd>
              <p>
                同じ動きをするものばかりなら、増減幅は{analysis.naive.toFixed(1)}%でした。
                バラけている分だけ、揺れが{analysis.benefit.toFixed(0)}%小さくなっています。
              </p>
            </div>
          </div>

          {analysis.excluded > 0 && (
            <p className="pf-note-small">
              「債券・その他」{yen(analysis.excluded)}は値動きのデータを持っていないため、
              上の計算からは外しています。
            </p>
          )}

          {/* ---------------- 税金 ---------------- */}

          <div className="pf-accounts">
            <h3>売るときにかかる税金</h3>
            <p className="pf-tax-lead">
              利益が出た分にかかります。<strong>商品によって税率がまったく違う</strong>ので、
              持っている場所より、まずここを知っておくと損をしません。
            </p>
            <table>
              <thead>
                <tr>
                  <th>区分</th>
                  <th className="right">金額</th>
                  <th>税金の扱い</th>
                </tr>
              </thead>
              <tbody>
                {(["none", "separate", "aggregate", "depends"] as TaxKind[])
                  .filter((k) => analysis.byTax[k] > 0)
                  .map((k) => (
                    <tr key={k}>
                      <td>
                        {k === "none" && "NISA・iDeCo"}
                        {k === "separate" && "株式・投資信託"}
                        {k === "aggregate" && "暗号資産"}
                        {k === "depends" && "金・外貨など"}
                      </td>
                      <td className="right mono">{yen(analysis.byTax[k])}</td>
                      <td className={k === "none" ? "free" : k === "aggregate" ? "heavy" : "taxed"}>
                        {TAX_LABEL[k]}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <ul className="pf-account-notes">
              {analysis.byTax.aggregate > 0 && (
                <li>
                  <strong>暗号資産は株式と扱いが違います。</strong>
                  利益は雑所得として給与などと合算され、所得が多い人ほど税率が上がります
                  （住民税を含め最大およそ55%）。株式の約20%とは別物です。
                  なお分離課税へ変える案が議論されていますが、まだ決まっていません。
                </li>
              )}
              {analysis.byTax.none > 0 && (
                <li>
                  NISA・iDeCo の <strong>{yen(analysis.byTax.none)}</strong> は利益が出ても税金がかかりません。
                  組み替えるなら、まずこちらのほうが手取りは減りにくくなります。
                </li>
              )}
              {analysis.byTax.depends > 0 && (
                <li>
                  金や外貨は<strong>買い方によって税金が変わります</strong>。
                  金ETFや投資信託なら約20%、金地金や純金積立なら給与と合算（年50万円の控除あり、
                  5年超の保有で対象額が半分）。外貨預金の為替差益も合算されます。
                </li>
              )}
              {(analysis.byAccount.ideco || 0) > 0 && (
                <li>
                  iDeCo の <strong>{yen(analysis.byAccount.ideco)}</strong> は原則60歳まで引き出せません。
                  当面の生活資金としては数えないでください。
                </li>
              )}
            </ul>
          </div>

          {/* ---------------- いまの相場 ---------------- */}

          {(analysis.relevant.length > 0 || analysis.usdRatio > 0.6) && (
            <div className="pf-now">
              <h3>いま気にしておきたいこと</h3>
              <ul>
                {analysis.usdRatio > 0.6 && (
                  <li>
                    資産の <strong>{(analysis.usdRatio * 100).toFixed(0)}%</strong> がドルで持っているのと
                    同じ状態です。銘柄は分かれていても、円高になれば<strong>まとめて目減りします</strong>。
                    種類は分けていても、通貨は1つに賭けている形です。
                  </li>
                )}
                {analysis.relevant.map((s) => (
                  <li key={`${s.a}-${s.b}`}>
                    <strong>
                      {assetName(s.a)}と{assetName(s.b)}
                    </strong>
                    は、これまで{s.base >= 0.25 ? "似た動き" : s.base <= -0.25 ? "反対の動き" : "無関係な動き"}
                    でしたが、最近は
                    {s.now >= 0.25 ? "似た動き" : s.now <= -0.25 ? "反対の動き" : "無関係な動き"}
                    に変わっています。両方お持ちなので、
                    {s.diff > 0
                      ? "以前より一緒に上下しやすくなっています。"
                      : "以前より打ち消し合いやすくなっています。"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---------------- ストレステスト ---------------- */}

          <div className="pf-stress">
            <h3>こうなったら、いくら減るか</h3>
            <p className="pf-stress-lead">
              過去に実際に起きた下落を参考にした<strong>仮の想定</strong>です。予測ではありません。
              下がったときにいくら減るかを、あらかじめ知っておくためのものです。
            </p>

            <ul className="stress-list">
              {SCENARIOS.map((sc) => {
                const { delta, lines } = applyScenario(analysis.byClass, sc);
                const after = total + delta;
                return (
                  <li key={sc.id}>
                    <div className="stress-head">
                      <span className="stress-name">{sc.name}</span>
                      <span className={`stress-delta ${delta < 0 ? "minus" : "plus"}`}>
                        {delta < 0 ? "−" : "+"}
                        {yen(Math.abs(delta))}
                      </span>
                    </div>
                    <p className="stress-after">
                      {yen(total)} → <strong>{yen(after)}</strong>
                      <span className="stress-pct">
                        （{delta < 0 ? "" : "+"}
                        {((delta / total) * 100).toFixed(1)}%）
                      </span>
                    </p>
                    <p className="stress-detail">{sc.detail}</p>
                    {lines.length > 0 && (
                      <p className="stress-lines">
                        内訳：
                        {lines
                          .map(
                            (l) =>
                              `${CLASS_BY_ID[l.klass].name} ${l.amount < 0 ? "−" : "+"}${yen(Math.abs(l.amount))}`
                          )
                          .join(" / ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ---------------- 試算 ---------------- */}

          {analysis.moves.length > 0 && (
            <div className="pf-sim">
              <h3>もし1割を移したら、揺れはどうなるか</h3>
              <p className="pf-sim-lead">
                揺れが小さくなる順に並べています。
                <strong>「こうしたほうがいい」という意味ではありません。</strong>
                揺れが小さいことと、儲かることは別です。売れば税金もかかります。
                考えるための材料として見てください。
              </p>
              <ul className="pf-moves">
                {analysis.moves.map((m) => (
                  <li key={`${m.from}-${m.to}`}>
                    <span className="pf-move-path">
                      {CLASS_BY_ID[m.from].name} → {CLASS_BY_ID[m.to].name}
                    </span>
                    <span className="pf-move-num">
                      1年の増減 ±{yen((analysis.sigma / 100) * analysis.base)} →{" "}
                      <strong>±{yen((m.sigma / 100) * analysis.base)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="pf-caveat">
            すべて過去の値動きをもとにした目安で、将来を約束するものではありません。
            特定の売買を勧めるものでもありません。個別の銘柄は種類ごとにまとめて計算しているため、
            同じ種類の中での違いは反映されません。税金の扱いは個別の事情で変わるため、
            実際の判断は国税庁の情報や税理士にご確認ください。
          </p>
        </>
      )}
    </section>
  );
}
