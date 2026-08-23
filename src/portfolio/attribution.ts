// 「なぜ増えたか・減ったか」を分解する。
//
// 考え方はプロが使う要因分解と同じで、
//   ある要因の寄与額 = その要因にさらしている割合 × その要因の変化率 × 資産総額
// で計算する。難しいのは日本人が外貨建て資産を持つ場合で、
// 円換算の損益には「現地の値動き」と「円高・円安」の2つが混ざっている。
// この2つを分けないと「なぜ減ったのか」が説明できないので、必ず分けて出す。

// 拡張子まで書いているのは、Node で直接動かして検算できるようにするため
// （tsconfig の allowImportingTsExtensions を有効にしてある）
import { CLASSES, CLASS_BY_ID, type ClassId } from "./model.ts";

export type AttributionData = {
  asOf: string;
  days: string[];
  local: Record<string, number[]>;
  fx: number[];
  usdBased: string[];
};

export type Factor = {
  id: string;
  label: string;
  yen: number;
  color: string;
};

/** その日（末尾から back 日前）の、要因ごとの寄与額 */
export function factorsForDay(
  weights: Partial<Record<ClassId, number>>,
  total: number,
  data: AttributionData,
  back = 0
): { factors: Factor[]; totalYen: number; dayLabel: string } {
  const idx = data.days.length - 1 - back;
  const factors: Factor[] = [];

  if (idx < 0) return { factors, totalYen: 0, dayLabel: "" };

  let fxExposure = 0;

  for (const c of CLASSES) {
    const w = weights[c.id] ?? 0;
    if (w <= 0) continue;

    // 外貨建てなら、為替の影響をまとめて別枠に積む
    if (c.usd) fxExposure += w;

    // 「外貨そのもの」は現地の値動きを持たない（為替がすべて）
    if (c.id === "fx" || !c.proxy || c.proxy === "cash") continue;

    const r = data.local[c.proxy]?.[idx];
    if (typeof r !== "number") continue;

    factors.push({
      id: c.id,
      label: c.name,
      yen: w * (r / 100) * total,
      color: c.color,
    });
  }

  const fxR = data.fx[idx];
  if (typeof fxR === "number" && fxExposure > 0) {
    factors.push({
      id: "fx_effect",
      label: fxR >= 0 ? "円安が進んだ" : "円高が進んだ",
      yen: fxExposure * (fxR / 100) * total,
      color: "var(--a-usdjpy)",
    });
  }

  factors.sort((a, b) => a.yen - b.yen); // 効いた順（マイナスが上）
  const totalYen = factors.reduce((s, f) => s + f.yen, 0);

  return { factors, totalYen, dayLabel: data.days[idx] };
}

/** 直近 span 日ぶんを足し上げた、要因ごとの累積寄与額 */
export function factorsForPeriod(
  weights: Partial<Record<ClassId, number>>,
  total: number,
  data: AttributionData,
  span: number
): Factor[] {
  const acc = new Map<string, Factor>();
  const n = Math.min(span, data.days.length);

  for (let back = 0; back < n; back++) {
    for (const f of factorsForDay(weights, total, data, back).factors) {
      const cur = acc.get(f.id);
      if (cur) cur.yen += f.yen;
      else acc.set(f.id, { ...f });
    }
  }

  // 期間で見ると円安/円高は行き来するので、合計の向きでラベルを付け直す
  const fx = acc.get("fx_effect");
  if (fx) fx.label = fx.yen >= 0 ? "円安（差引）" : "円高（差引）";

  return [...acc.values()].sort((a, b) => a.yen - b.yen);
}

/** 資産全体の、1日あたりの騰落率（%）の系列。「普通かどうか」の判定に使う */
export function dailyPortfolioReturns(
  weights: Partial<Record<ClassId, number>>,
  data: AttributionData
): number[] {
  const out: number[] = [];

  let fxExposure = 0;
  for (const c of CLASSES) if (c.usd) fxExposure += weights[c.id] ?? 0;

  for (let i = 0; i < data.days.length; i++) {
    let r = 0;
    for (const c of CLASSES) {
      const w = weights[c.id] ?? 0;
      if (w <= 0 || c.id === "fx" || !c.proxy || c.proxy === "cash") continue;
      const v = data.local[c.proxy]?.[i];
      if (typeof v === "number") r += w * v;
    }
    const fxR = data.fx[i];
    if (typeof fxR === "number") r += fxExposure * fxR;
    out.push(r);
  }

  return out;
}

/**
 * 今日の動きが、過去1年の中でどのくらい珍しいかを言葉にする。
 * 初心者が狼狽しないために、いちばん効く一文。
 */
export function normality(todayPct: number, series: number[]) {
  const past = series.slice(0, -1);
  if (past.length < 30) return null;

  const same = past.filter((v) =>
    todayPct < 0 ? v <= todayPct : v >= todayPct
  ).length;

  const ratio = same / past.length;
  const dir = todayPct < 0 ? "下げ" : "上げ";

  if (Math.abs(todayPct) < 0.15)
    return { tone: "calm", text: "ほとんど動いていません。静かな一日です。" };

  if (ratio >= 0.1)
    return {
      tone: "calm",
      text: `これは普通の範囲です。過去1年で、同じくらいの${dir}は ${same} 回ありました。`,
    };

  if (ratio >= 0.03)
    return {
      tone: "notable",
      text: `やや大きめの${dir}です。過去1年で ${same} 回しかない水準でした。`,
    };

  return {
    tone: "rare",
    text: `過去1年で ${same} 回しかない、かなり大きな${dir}です。ただし、こうした日は必ず起こります。`,
  };
}

/** 保有明細から、クラス別の構成比を出す */
export function weightsOf(byClass: Record<string, number>, total: number) {
  const w: Partial<Record<ClassId, number>> = {};
  if (total <= 0) return w;
  for (const c of CLASSES) w[c.id] = (byClass[c.id] || 0) / total;
  return w;
}

/** 入力がない人にも価値が伝わるよう、一般的な構成を用意しておく */
export const SAMPLE_WEIGHTS: Partial<Record<ClassId, number>> = {
  jp_stock: 0.15,
  us_stock: 0.45,
  gold: 0.1,
  crypto: 0.05,
  cash: 0.25,
};

export const SAMPLE_TOTAL = 5_000_000;

export const classColor = (id: string) => CLASS_BY_ID[id as ClassId]?.color ?? "var(--ink-3)";
