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

export type Highlights = {
  asOf: string;
  regime: { label: string; detail: string } | null;
  items: { kind: "move" | "unusual" | "shift"; text: string }[];
  shifts: Shift[];
};
