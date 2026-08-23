// ポートフォリオの用語・分類・計算をここに集約する。
// 画面(Portfolio.tsx)は表示に専念させ、数字の意味はこのファイルだけを読めば分かるようにする。

import type { CorrelationWindow, History } from "../types";

// ---------------------------------------------------------------- 資産クラス
// 個別株やETFは銘柄ごとの相関データを持っていないため、
// 「何と連動して動くか」でクラスに束ねてからリスクを計算する。
// 推測でデータを埋めるより、束ねる単位を正直に示すほうが誤解が少ない。

export type ClassId = "jp_stock" | "us_stock" | "fx" | "gold" | "crypto" | "cash" | "other";

export const CLASSES: {
  id: ClassId;
  name: string;
  hint: string;
  /** 相関・変動率データの参照先。null は試算の対象外 */
  proxy: string | null;
  /** 実質的にドル建てか（円高で目減りするか） */
  usd: boolean;
  color: string;
}[] = [
  { id: "jp_stock", name: "日本株", hint: "国内個別株・日経連動ETF・国内株投信", proxy: "nikkei", usd: false, color: "var(--a-nikkei)" },
  { id: "us_stock", name: "米国株・先進国株", hint: "VOO・VTI・eMAXIS Slim 全世界 など", proxy: "sp500", usd: true, color: "var(--a-sp500)" },
  { id: "fx", name: "外貨・外貨MMF", hint: "ドル預金・外貨MMF", proxy: "usdjpy", usd: true, color: "var(--a-usdjpy)" },
  { id: "gold", name: "金・コモディティ", hint: "金ETF・純金積立", proxy: "gold", usd: true, color: "var(--a-gold)" },
  { id: "crypto", name: "暗号資産", hint: "ビットコイン・イーサリアム", proxy: "btc", usd: true, color: "var(--a-btc)" },
  { id: "cash", name: "現金・預金", hint: "円預金・MRF", proxy: "cash", usd: false, color: "var(--ink-3)" },
  { id: "other", name: "債券・その他", hint: "個人向け国債・REIT・保険など", proxy: null, usd: false, color: "var(--rule-strong)" },
];

export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<
  ClassId,
  (typeof CLASSES)[number]
>;

// ---------------------------------------------------------------- 口座区分

export type AccountId = "nisa_growth" | "nisa_tsumitate" | "tokutei" | "ippan" | "ideco" | "other";

export const ACCOUNTS: { id: AccountId; name: string; taxFree: boolean; note: string }[] = [
  { id: "nisa_growth", name: "NISA 成長投資枠", taxFree: true, note: "売却益・配当が非課税。売却した分の枠は翌年に復活します（簿価ベース）" },
  { id: "nisa_tsumitate", name: "NISA つみたて投資枠", taxFree: true, note: "売却益・配当が非課税。対象は長期積立向けの投信に限られます" },
  { id: "tokutei", name: "特定口座", taxFree: false, note: "売却益に約20%（所得税・住民税）が課税されます" },
  { id: "ippan", name: "一般口座", taxFree: false, note: "売却益に約20%が課税され、損益計算も自分で行う必要があります" },
  { id: "ideco", name: "iDeCo", taxFree: true, note: "運用益は非課税ですが、原則60歳まで引き出せません" },
  { id: "other", name: "その他", taxFree: false, note: "" },
];

export const ACCOUNT_BY_ID = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a])) as Record<
  AccountId,
  (typeof ACCOUNTS)[number]
>;

/** 新NISAの生涯投資枠（簿価ベース） */
export const NISA_LIFETIME = 18_000_000;

// ---------------------------------------------------------------- 保有明細

export type Holding = {
  key: string;
  name: string;
  klass: ClassId;
  account: AccountId;
  amount: number;
};

export const newHolding = (): Holding => ({
  key: Math.random().toString(36).slice(2, 10),
  name: "",
  klass: "jp_stock",
  account: "tokutei",
  amount: 0,
});

// ---------------------------------------------------------------- 計算

/**
 * ポートフォリオ全体の変動率（年率）。
 * 相関を織り込むため、各資産の変動率を単純平均した値より必ず小さくなる。
 * その差が「分散の効果」にあたる。
 */
export function portfolioVol(
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

/**
 * 同じ配分を保ったまま過去をなぞった場合の、山から谷までの最大下落幅（%）。
 * 年率の変動率より直感的に「どこまで落ちうるか」が伝わる。
 * 配分を維持し続けた（都度リバランスした）前提の概算。
 */
export function maxDrawdown(
  weights: Record<string, number>,
  history: History
): { drop: number; from: string; to: string } | null {
  const ids = Object.keys(weights).filter((id) => weights[id] > 0 && history.series[id]);
  const cashWeight = weights.cash ?? 0;
  if (ids.length === 0 && cashWeight === 0) return null;

  const n = history.days.length;
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = cashWeight * 100; // 現金は動かない
    for (const id of ids) v += weights[id] * history.series[id][i];
    index.push(v);
  }

  let peak = index[0];
  let peakAt = 0;
  let worst = 0;
  let from = history.days[0];
  let to = history.days[0];

  for (let i = 1; i < n; i++) {
    if (index[i] > peak) {
      peak = index[i];
      peakAt = i;
    }
    const dd = (index[i] / peak - 1) * 100;
    if (dd < worst) {
      worst = dd;
      from = history.days[peakAt];
      to = history.days[i];
    }
  }

  return { drop: worst, from, to };
}

// ---------------------------------------------------------------- 表示補助

export const yen = (v: number) =>
  v >= 1e8
    ? `${(v / 1e8).toFixed(2)}億円`
    : v >= 1e4
      ? `${Math.round(v / 1e4).toLocaleString("ja-JP")}万円`
      : `${Math.round(v).toLocaleString("ja-JP")}円`;
