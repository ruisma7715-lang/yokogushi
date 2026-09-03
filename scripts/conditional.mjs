// ヨコグシ — こういう日は、どうなるか（条件付きの見え方）
//
// 相関マトリクスは「全部の日を平均するとこう」という数字で、
// 「ドル円が大きく動いた日に金はどうだったか」には答えられない。
// 平均に埋もれる話をここで拾う。
//
// 設計上の決めごとが3つある。
//
// 1. 閾値は固定値ではなく分位点にする。
//    「ドル円が2円動いた日」を固定で切ると、直近1年では該当が2日しかない。
//    上位10%で切れば、期間が変わっても常に十分な日数が残る。
//    実際の閾値は表示するので、読み手には具体値が見える。
//
// 2. 米10年債だけ単位が違う。
//    利回りは「%ポイントの差」、他5資産は「%の変化率」。
//    同じ棒の目盛りに並べると、比べられないものを比べたことになる。
//    数値は各々の単位のまま出し、棒はσ（その資産の普段の1日の値動き）で揃える。
//
// 3. 該当日数が少ない条件は数字を出さない。
//    20日に満たないものは、たまたまでいくらでも動く。
//    「まだ判断できません」と書くほうが、それらしい数字を出すより正しい。

const MIN_DAYS = 20; // これ未満は傾向として扱わない
const EQ_T = 0.3; // 株が「動いた」とみなす閾値(%)。judgeRegime と揃えている
const TAIL = 0.1; // 分位点。上位・下位10%を「大きく動いた日」とする

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

/** 昇順に並べたときの分位点 */
function quantile(values, q) {
  const s = [...values].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/**
 * 条件付きの見え方を組み立てる。
 *
 * @param {object}   o
 * @param {object[]} o.live        稼働中の資産（id と name）
 * @param {string[]} o.ids
 * @param {string[]} o.days        全資産が揃った日（昇順）
 * @param {object}   o.values      values[id] = その日の水準の配列（days と同じ長さ）
 * @param {string}   o.asOf
 */
export function buildConditional({ live, ids, days, values, asOf }) {
  const nameOf = (id) => live.find((a) => a.id === id)?.name ?? id;
  const has = (id) => ids.includes(id);

  // 前日比。米10年債だけ差（%pt）、他は変化率（%）。
  // 利回りの「何%上がったか」は読者にとって意味が薄く、差のほうが通じる。
  const isPt = (id) => id === "us10y";
  const chg = {};
  for (const id of ids) {
    const p = values[id];
    chg[id] = [];
    for (let i = 1; i < p.length; i++) {
      chg[id].push(isPt(id) ? p[i] - p[i - 1] : (p[i] / p[i - 1] - 1) * 100);
    }
  }

  const n = days.length - 1; // リターンは1日短い
  if (n < MIN_DAYS * 2) return null; // そもそも母数が足りない

  const sigma = Object.fromEntries(ids.map((id) => [id, stdev(chg[id])]));

  // 全期間の姿。条件付きの数字は、これと比べて初めて意味が出る。
  const baseline = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        mean: Number(mean(chg[id]).toFixed(3)),
        upRate: Math.round((chg[id].filter((v) => v > 0).length / n) * 100),
      },
    ])
  );

  // --- 条件の定義。どれも「その日の値」だけで決まる（先読みをしない）。
  const eqIds = ["nikkei", "sp500"].filter(has);
  const eqMean = (i) => mean(eqIds.map((id) => chg[id][i]));

  const conditions = [];
  const add = (c) => conditions.push(c);

  if (eqIds.length) {
    add({
      id: "equity-down",
      label: "株が売られた日",
      detail: `${eqIds.map(nameOf).join("と")}の平均が −${EQ_T}% を下回った日`,
      pick: (i) => eqMean(i) < -EQ_T,
    });
  }

  if (eqIds.length && has("gold")) {
    add({
      id: "risk-off",
      label: "リスクオフの日",
      detail: `株が売られ、同じ日に金が買われた日（サイトの判定と同じ条件）`,
      note: "金が上がった日を選んでいるので、金の数字が大きいのは当たり前。見るべきは他の5つ。",
      pick: (i) => eqMean(i) < -EQ_T && chg.gold[i] > EQ_T,
    });
  }

  if (has("us10y")) {
    const hi = quantile(chg.us10y, 1 - TAIL);
    const lo = quantile(chg.us10y, TAIL);
    add({
      id: "yield-up",
      label: "米金利が大きく上がった日",
      detail: `米10年債利回りが1日で +${hi.toFixed(2)}pt 以上動いた日（上位10%）`,
      pick: (i) => chg.us10y[i] >= hi,
    });
    add({
      id: "yield-down",
      label: "米金利が大きく下がった日",
      detail: `米10年債利回りが1日で ${lo.toFixed(2)}pt 以下だった日（下位10%）`,
      pick: (i) => chg.us10y[i] <= lo,
    });
  }

  if (has("usdjpy")) {
    // 為替は「円でいくら」のほうが体感に近いので、閾値の表示だけ円に直す。
    const yen = [];
    for (let i = 1; i < values.usdjpy.length; i++) yen.push(values.usdjpy[i] - values.usdjpy[i - 1]);
    const hiY = quantile(yen, 1 - TAIL);
    const loY = quantile(yen, TAIL);

    add({
      id: "yen-weak",
      label: "円が大きく安くなった日",
      detail: `ドル円が1日で +${hiY.toFixed(2)}円 以上動いた日（上位10%）`,
      pick: (i) => yen[i] >= hiY,
    });
    add({
      id: "yen-strong",
      label: "円が大きく高くなった日",
      detail: `ドル円が1日で ${loY.toFixed(2)}円 以下だった日（下位10%）`,
      pick: (i) => yen[i] <= loY,
    });
  }

  // --- 各条件で6資産がどう動いたかを集計する。
  const out = conditions.map((c) => {
    const hit = [];
    for (let i = 0; i < n; i++) if (c.pick(i)) hit.push(i);

    const assets = Object.fromEntries(
      ids.map((id) => {
        const vals = hit.map((i) => chg[id][i]);
        const m = mean(vals);
        return [
          id,
          {
            mean: Number(m.toFixed(3)),
            upRate: hit.length ? Math.round((vals.filter((v) => v > 0).length / hit.length) * 100) : 0,
            // 棒の長さに使う。単位の違う資産を並べても嘘にならない唯一の尺度。
            z: sigma[id] ? Number((m / sigma[id]).toFixed(3)) : 0,
            unit: isPt(id) ? "pt" : "%",
          },
        ];
      })
    );

    return {
      id: c.id,
      label: c.label,
      detail: c.detail,
      note: c.note ?? null,
      n: hit.length,
      // 少ない日数から傾向を語らない。読み手に数字を見せない形で止める。
      enough: hit.length >= MIN_DAYS,
      assets,
    };
  });

  return {
    asOf,
    window: { from: days[1], to: days[days.length - 1], days: n },
    minDays: MIN_DAYS,
    baseline,
    conditions: out,
  };
}

/**
 * その日どこにお金が行ったかを、実際の値から書く。
 *
 * judgeRegime のラベルは株と金の2つだけで決めているが、
 * 「安全な置き場所に逃げた」と書くなら、どこへ逃げたのかを見て書かないと
 * 検証していないことを書いたことになる。
 *
 * @param {object}   dayChange   資産IDごとの前日比(%)
 * @param {object[]} live
 * @param {object}   [opts]
 * @param {string[]} [opts.exclude]  ラベル側で既に触れている資産。文を重複させない
 * @param {number}   [opts.us10yPt]  米10年債の「差」(%pt)。dayChange 側は変化率なので別に渡す
 */
export function describeFlow(dayChange, live, opts = {}) {
  const nameOf = (id) => live.find((a) => a.id === id)?.name ?? id;
  const exclude = opts.exclude ?? [];
  const T = 0.3;

  // 株以外で、その日に実際に買われたもの・売られたもの。
  const others = ["gold", "btc", "usdjpy", "us10y"].filter(
    (id) => dayChange[id] !== undefined && !exclude.includes(id)
  );
  const up = others.filter((id) => dayChange[id] > T);
  const down = others.filter((id) => dayChange[id] < -T);

  const say = (id) => {
    const v = dayChange[id];
    // 為替は上下より円安・円高のほうが通じる
    if (id === "usdjpy") return `ドル円は${v > 0 ? "円安" : "円高"}に ${Math.abs(v).toFixed(2)}%`;
    // 利回りは「何%上がったか」より「何ポイント動いたか」で読まれる
    if (id === "us10y" && Number.isFinite(opts.us10yPt)) {
      return `米10年債利回りは ${opts.us10yPt > 0 ? "+" : "−"}${Math.abs(opts.us10yPt).toFixed(2)}pt`;
    }
    return `${nameOf(id)}は ${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  };

  if (!up.length && !down.length) return "ほかの資産は大きく動いていません。";
  if (!up.length) return `${down.map(say).join("、")}で、買われたものはありません。`;

  return `${up.map(say).join("、")}${down.length ? `。一方で${down.map(say).join("、")}` : ""}。`;
}
