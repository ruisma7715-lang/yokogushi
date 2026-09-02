// scripts/fetch.mjs が書き出すJSONの形。
// スクリプト側の出力を変えたら、ここも必ず合わせること。

export type AssetId = "nikkei" | "sp500" | "usdjpy" | "gold" | "btc" | "us10y";

export type AssetSnapshot = {
  id: AssetId;
  name: string;
  cls: string;
  unit: string;
  /** この資産の値がいつ時点か。公表の早さがソースごとに違うため資産ごとに持つ */
  asOf: string;
  value: number;
  changeDay: number | null;
  changeWeek: number | null;
  changeMonth: number | null;
  /** 年率換算の変動率(%)。ポートフォリオのリスク試算に使う */
  vol: number;
};

export type Latest = {
  /** いちばん新しい資産の日付。ページの「最終更新」に使う */
  asOf: string;
  /** 全6資産の値が揃った直近の日。相関などの横断の分析はこの日付が基準 */
  alignedAsOf: string;
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
  regime: { label: string; detail: string; asOf?: string } | null;
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

/** 今日の市場に出す指数。カードの6資産とは別で、横断ではなく市場の内訳を見るためのもの */
export type MarketIndex = {
  id: string;
  name: string;
  /** その指数が何を映すか（「大型ハイテク」など）。方向が割れた日の説明に使う */
  note?: string;
  value: number;
  changeDay: number | null;
  changeWeek: number | null;
};

export type MarketVix = {
  /** 指数と同じ日に揃わないことがあるため、VIX自身の日付を持つ */
  asOf: string;
  value: number;
  changeDay: number | null;
  avg60: number | null;
};

/**
 * 今日の市場。asOf は latest.asOf でも alignedAsOf でもない第3の軸で、
 * 「米国の指数どうしが揃った日」。ナスダックとダウを比べる話なので、
 * 同じ日の値でなければ比較が成立しない。日本は日経平均の最新日。
 */
export type MarketInternals = {
  us: {
    asOf: string;
    indices: MarketIndex[];
    vix: MarketVix | null;
    lines: string[];
  } | null;
  jp: {
    asOf: string;
    indices: MarketIndex[];
    /** 過去1年の値幅の中での位置(%)。1年ぶん揃っていなければ null */
    range52: number | null;
    /** ドル建て日経平均の前日比(%)。為替を抜いた海外から見た日本株 */
    usdChangeDay: number | null;
    lines: string[];
  } | null;
  failed: string[];
};

export type Topics = {
  generatedAt: string;
  /** 生成時点の日本時間の日付。カレンダーの「今夜／明日」はこれを基準にする */
  today: string;
  calendar: CalendarEntry[];
  headlines: Headline[];
  /** 古いJSONには無いので任意。取得に失敗した日も null になる */
  market?: MarketInternals | null;
  failed: string[];
};
