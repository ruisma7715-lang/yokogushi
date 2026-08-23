// ポートフォリオの用語・分類・計算をここに集約する。
// 画面(Portfolio.tsx)は表示に専念させ、数字の意味はこのファイルだけを読めば分かるようにする。

import type { CorrelationWindow, History } from "../types";

// ---------------------------------------------------------------- 資産クラス
// 個別株やETFは銘柄ごとの相関データを持っていないため、
// 「何と連動して動くか」でクラスに束ねてからリスクを計算する。
// 推測でデータを埋めるより、束ねる単位を正直に示すほうが誤解が少ない。

export type ClassId = "jp_stock" | "us_stock" | "fx" | "gold" | "crypto" | "cash" | "other";

/**
 * 課税方式。日本では商品によって扱いがまったく違うため、一律の税率で丸めない。
 * - separate : 申告分離課税（約20.315%）
 * - aggregate: 総合課税（雑所得）。給与などと合算した累進税率で、最大約55%
 * - depends  : 商品の形態によって分かれる（金地金か金ETFか、など）
 * - none     : 課税されない（NISA・iDeCo）
 */
export type TaxKind = "separate" | "aggregate" | "depends" | "none";

export const TAX_LABEL: Record<TaxKind, string> = {
  separate: "分離課税 約20.315%",
  aggregate: "総合課税（雑所得）最大約55%",
  depends: "商品の形態による",
  none: "非課税",
};

export const CLASSES: {
  id: ClassId;
  name: string;
  hint: string;
  /** 相関・変動率データの参照先。null は試算の対象外 */
  proxy: string | null;
  /** 実質的にドル建てか（円高で目減りするか） */
  usd: boolean;
  /** 課税口座で持った場合の扱い */
  tax: TaxKind;
  taxNote: string;
  /** 選べる口座区分。制度上ありえない組み合わせは出さない */
  accounts: AccountId[];
  color: string;
}[] = [
  {
    id: "jp_stock", name: "日本株", hint: "国内個別株・日経連動ETF・国内株投信",
    proxy: "nikkei", usd: false, tax: "separate",
    taxNote: "売却益・配当ともに申告分離課税です。",
    accounts: ["nisa_growth", "nisa_tsumitate", "tokutei", "ippan", "ideco"],
    color: "var(--a-nikkei)",
  },
  {
    id: "us_stock", name: "米国株・先進国株", hint: "VOO・VTI・eMAXIS Slim 全世界 など",
    proxy: "sp500", usd: true, tax: "separate",
    taxNote: "申告分離課税です。米国株の配当は現地でも10%引かれ、外国税額控除の対象になります。",
    accounts: ["nisa_growth", "nisa_tsumitate", "tokutei", "ippan", "ideco"],
    color: "var(--a-sp500)",
  },
  {
    id: "fx", name: "外貨・外貨MMF", hint: "ドル預金・外貨MMF・FX",
    proxy: "usdjpy", usd: true, tax: "depends",
    taxNote: "外貨預金の為替差益は雑所得（総合課税）、外貨MMFとFXは申告分離課税です。",
    accounts: ["tokutei", "ippan", "bank", "other"],
    color: "var(--a-usdjpy)",
  },
  {
    id: "gold", name: "金・コモディティ", hint: "金ETF・純金積立・金地金",
    proxy: "gold", usd: true, tax: "depends",
    taxNote: "金ETF・投資信託は申告分離課税。金地金・純金積立の売却益は譲渡所得（総合課税）で、年50万円の特別控除があり、保有5年超なら課税対象が半分になります。",
    accounts: ["nisa_growth", "tokutei", "ippan", "other"],
    color: "var(--a-gold)",
  },
  {
    id: "crypto", name: "暗号資産", hint: "ビットコイン・イーサリアム",
    proxy: "btc", usd: true, tax: "aggregate",
    taxNote:
      "売却益・交換益は雑所得として総合課税です。給与などと合算した累進税率がかかるため、" +
      "所得が多い人ほど負担が重く、住民税を含めると最大で約55%になります。" +
      "申告分離課税（約20%）への変更が税制改正の要望として議論されていますが、現時点では決まっていません。",
    accounts: ["crypto_exchange"],
    color: "var(--a-btc)",
  },
  {
    id: "cash", name: "現金・預金", hint: "円預金・MRF",
    proxy: "cash", usd: false, tax: "none",
    taxNote: "利息には約20.315%が源泉徴収されますが、元本に対する課税はありません。",
    accounts: ["bank", "tokutei", "other"],
    color: "var(--ink-3)",
  },
  {
    id: "other", name: "債券・その他", hint: "個人向け国債・REIT・保険など",
    proxy: null, usd: false, tax: "depends",
    taxNote: "個人向け国債やREITは申告分離課税ですが、保険や年金商品は扱いが異なります。",
    accounts: ["nisa_growth", "tokutei", "ippan", "ideco", "bank", "other"],
    color: "var(--rule-strong)",
  },
];

/** その保有分に実際に適用される課税方式。口座区分が優先する */
export function taxOf(klass: ClassId, account: AccountId): TaxKind {
  if (ACCOUNT_BY_ID[account]?.taxFree) return "none";
  return CLASS_BY_ID[klass]?.tax ?? "depends";
}

export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<
  ClassId,
  (typeof CLASSES)[number]
>;

// ---------------------------------------------------------------- 口座区分

export type AccountId =
  | "nisa_growth"
  | "nisa_tsumitate"
  | "tokutei"
  | "ippan"
  | "ideco"
  | "crypto_exchange"
  | "bank"
  | "other";

export const ACCOUNTS: { id: AccountId; name: string; taxFree: boolean; note: string }[] = [
  { id: "nisa_growth", name: "NISA 成長投資枠", taxFree: true, note: "売却益・配当が非課税。売却した分の枠は翌年に復活します（簿価ベース）" },
  { id: "nisa_tsumitate", name: "NISA つみたて投資枠", taxFree: true, note: "売却益・配当が非課税。対象は長期積立向けの投信に限られます" },
  { id: "tokutei", name: "特定口座", taxFree: false, note: "証券口座。損益計算を証券会社が代行してくれます" },
  { id: "ippan", name: "一般口座", taxFree: false, note: "証券口座。損益計算を自分で行う必要があります" },
  { id: "ideco", name: "iDeCo", taxFree: true, note: "運用益は非課税ですが、原則60歳まで引き出せません" },
  { id: "crypto_exchange", name: "暗号資産交換業者", taxFree: false, note: "NISAや特定口座の対象外です。損益計算は自分で行う必要があります" },
  { id: "bank", name: "銀行・その他", taxFree: false, note: "" },
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

// ---------------------------------------------------------------- 取り込み
// 証券会社の保有一覧をコピーして貼るだけで明細を作れるようにする。
// 各社で書式が違うので、完全な自動判別は諦め、
// 「だいたい合っている行を作って、あとは目で直してもらう」方針にしている。

const NAME_KEYS = ["銘柄", "ファンド", "名称", "商品", "コイン", "通貨名"];
const AMOUNT_KEYS = ["評価額", "時価", "残高", "評価金額", "金額", "資産額"];

/**
 * 銘柄名から資産クラスを推測する。外したぶんは画面で直せる前提の割り切り。
 *
 * 判定順に意味がある。「預金」「年金」「資金」はどれも『金』を含むため、
 * 先に現金として判定してからでないと、金（ゴールド）に吸い込まれてしまう。
 * 同じ理由で、金の判定に裸の「金」は使わず、金だと確実に分かる語だけで拾う。
 */
export function guessClass(name: string): ClassId {
  const s = name.toLowerCase().trim();
  const has = (...ws: string[]) => ws.some((w) => s.includes(w.toLowerCase()));

  if (has("預金", "現金", "普通", "定期", "mrf", "キャッシュ", "待機資金")) return "cash";

  if (has("ビットコイン", "btc", "イーサ", "eth", "リップル", "xrp", "ソラナ", "暗号資産", "仮想通貨"))
    return "crypto";

  if (has("債券", "国債", "社債", "bond", "reit", "リート", "保険", "年金")) return "other";

  if (has("米ドル", "外貨", "ドルmmf", "usd", "ユーロ", "為替", "fx")) return "fx";

  if (s === "金" || has("純金", "金地金", "ゴールド", "gold", "プラチナ", "コモディティ", "金投資"))
    return "gold";

  if (
    has(
      "米国", "全世界", "先進国", "オルカン", "オール・カントリー", "emaxis", "s&p", "sp500",
      "nasdaq", "ナスダック", "ダウ", "voo", "vti", "qqq", "spy", "外国株", "グローバル", "世界株"
    )
  )
    return "us_stock";

  return "jp_stock";
}

function splitRow(line: string): string[] {
  // タブ区切り（画面からのコピー）を優先し、無ければカンマ区切り
  const cells = line.includes("\t") ? line.split("\t") : line.split(",");
  return cells.map((c) => c.trim().replace(/^"|"$/g, ""));
}

const toNumber = (s: string) => {
  const n = Number(s.replace(/[,¥￥円\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * 貼り付けたテキストから保有明細を組み立てる。
 * ヘッダー行が見つかればその列を使い、無ければ
 * 「最初の文字列っぽい列＝銘柄名」「いちばん大きい数値＝評価額」で当てる。
 */
export function parseHoldingsText(text: string, account: AccountId): Holding[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  let nameCol = -1;
  let amountCol = -1;
  let start = 0;

  const head = splitRow(lines[0]);
  const headLooksLikeHeader = head.some((c) => NAME_KEYS.some((k) => c.includes(k)));

  if (headLooksLikeHeader) {
    head.forEach((c, i) => {
      if (nameCol < 0 && NAME_KEYS.some((k) => c.includes(k))) nameCol = i;
      if (amountCol < 0 && AMOUNT_KEYS.some((k) => c.includes(k))) amountCol = i;
    });
    start = 1;
  }

  const out: Holding[] = [];

  for (let i = start; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length < 2) continue;

    let name = nameCol >= 0 ? cells[nameCol] : "";
    let amount = amountCol >= 0 ? toNumber(cells[amountCol]) : NaN;

    if (!name) {
      // 数字だけでない、いちばん左のセルを銘柄名とみなす（証券コードは飛ばす）
      const found = cells.find((c) => c && Number.isNaN(toNumber(c)) && !/^\d+$/.test(c));
      name = found ?? "";
    }

    if (!Number.isFinite(amount)) {
      // いちばん大きい数値を評価額とみなす。数量や単価より大きいのが普通
      const nums = cells.map(toNumber).filter((n) => Number.isFinite(n) && n > 0);
      amount = nums.length ? Math.max(...nums) : NaN;
    }

    if (!name || !Number.isFinite(amount) || amount <= 0) continue;

    const klass = guessClass(name);
    const allowed = CLASS_BY_ID[klass].accounts;

    out.push({
      key: Math.random().toString(36).slice(2, 10),
      name: name.slice(0, 40),
      klass,
      account: allowed.includes(account) ? account : allowed[0],
      amount: Math.round(amount),
    });
  }

  return out;
}

// ---------------------------------------------------------------- 表示補助

export const yen = (v: number) =>
  v >= 1e8
    ? `${(v / 1e8).toFixed(2)}億円`
    : v >= 1e4
      ? `${Math.round(v / 1e4).toLocaleString("ja-JP")}万円`
      : `${Math.round(v).toLocaleString("ja-JP")}円`;
