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
};

export type Latest = {
  asOf: string;
  assets: AssetSnapshot[];
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
