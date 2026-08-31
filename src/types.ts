// scripts/fetch.mjs が書き出すJSONの形。
// スクリプト側の出力を変えたら、ここも必ず合わせること。

export type AssetId = "nikkei" | "sp500" | "usdjpy" | "gold" | "btc" | "us10y";

export type AssetSnapshot = {
  id: AssetId;
  name: string;
  cls: string;
  unit: string;
  value: number;
  changeDay: number | null;
  changeWeek: number | null;
  changeMonth: number | null;
  /** 年率換算の変動率(%)。ポートフォリオのリスク試算に使う */
  vol: number;
};

export type Latest = {
  asOf: string;
  assets: AssetSnapshot[];
  /** 数量入力から円建ての評価額を出すための単価 */
  units: { usd_jpy: number | null; btc_jpy: number | null; gold_jpy_per_g: number | null };
  skipped: AssetId[];
};

export type CorrelationWindow = Record<string, Record<string, number | null>>;

export type Correlation = {
  asOf: string;
  windows: { d30: CorrelationWindow; d90: CorrelationWindow; d365: CorrelationWindow };
};

export type History = {
  asOf: string;
  days: string[];
  series: Record<string, number[]>;
};

export type Shift = { a: string; b: string; now: number; base: number; diff: number };

/** 自動生成の「今日の3行」。kind は切り口の種類（値動き・節目・予定 など） */
export type LeadLine = { kind: string; text: string };

export type Highlights = {
  asOf: string;
  regime: { label: string; detail: string } | null;
  /** 古いJSONには無いことがあるので任意。無ければ items を使う */
  lead?: LeadLine[];
  items: { kind: "move" | "unusual" | "shift"; text: string }[];
  shifts: Shift[];
};

export type CalendarEntry = { date: string; name: string; why: string };

export type Headline = {
  source: string;
  title: string;
  url: string;
  date: string | null;
  tag: string | null;
};

export type Topics = {
  generatedAt: string;
  /** 生成時点の日本時間の日付。カレンダーの「今夜／明日」はこれを基準にする */
  today: string;
  calendar: CalendarEntry[];
  headlines: Headline[];
  failed: string[];
};
