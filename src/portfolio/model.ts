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
  /** qty = 数量から自動計算（価格データがあるものだけ）、amount = 金額を直接入れる */
  mode: "amount" | "qty";
  /** 円。mode="qty" のときは計算結果が入る */
  amount: number;
  /** 暗号資産の枚数 / 金のグラム / 外貨のドル */
  qty: number;
  /**
   * 暗号資産のとき、どの通貨の枚数か（units.coins のキー）。
   * イーサリアムやリップルを1BTCの価格で計算しないために持つ。
   */
  coin?: string;
  /** 金額を入れた時点のクラス指数。以後の値動きに自動で追従させるために覚えておく */
  baseIndex?: number;
};

export const newHolding = (account: AccountId = "tokutei"): Holding => ({
  key: Math.random().toString(36).slice(2, 10),
  name: "",
  klass: "jp_stock",
  account,
  mode: "amount",
  amount: 0,
  qty: 0,
});

/** 数量で入力できるクラスと、その単位。個別株は現在価格が取れないため対象外。
 *  暗号資産は銘柄ごとに単位も価格も違うので、ここには置かず qtyUnit で解決する。 */
export const QTY_UNIT: Partial<Record<ClassId, { label: string; step: string }>> = {
  gold: { label: "g", step: "1" },
  fx: { label: "ドル", step: "1" },
};

export type CoinPrice = { ticker: string; name: string; step: string; jpy: number };

export type Units = {
  usd_jpy: number | null;
  btc_jpy: number | null;
  gold_jpy_per_g: number | null;
  /** 暗号資産の円建て単価。fetch.mjs の COINS に足せばここに増える */
  coins?: Record<string, CoinPrice>;
};

export const DEFAULT_COIN = "btc";

/** 保有している暗号資産の銘柄。未指定はビットコインとみなす */
export const coinOf = (h: Holding) => h.coin ?? DEFAULT_COIN;

/** その行の数量の単位。暗号資産だけ、選んでいる銘柄で変わる */
export function qtyUnit(h: Holding, units: Units): { label: string; step: string } | null {
  if (h.klass !== "crypto") return QTY_UNIT[h.klass] ?? null;

  const c = units.coins?.[coinOf(h)];
  if (c) return { label: c.ticker, step: c.step };
  // 単価データが無い日でも、ビットコインだけは6資産の値から計算できる
  return units.btc_jpy ? { label: "BTC", step: "0.00001" } : null;
}

/** 1単位あたりの円価格 */
export function unitPrice(klass: ClassId, units: Units, coin?: string): number | null {
  if (klass === "crypto") return units.coins?.[coin ?? DEFAULT_COIN]?.jpy ?? units.btc_jpy;
  if (klass === "gold") return units.gold_jpy_per_g;
  if (klass === "fx") return units.usd_jpy;
  return null;
}

/**
 * その保有の、いまの評価額（円）。
 * 数量入力なら現在価格をかけ、金額入力なら入力時点からの値動き分だけ伸縮させる。
 * 個別株は指数と完全には一致しないが、入れ直さずに概算を保てるほうが実用的と判断した。
 */
export function currentValue(
  h: Holding,
  units: Units,
  indexNow: Record<string, number>
): number {
  if (h.mode === "qty") {
    const p = unitPrice(h.klass, units, coinOf(h));
    return p ? Math.round(h.qty * p) : 0;
  }
  const proxy = CLASS_BY_ID[h.klass]?.proxy;
  if (!proxy || !h.baseIndex || !indexNow[proxy]) return h.amount;
  return Math.round(h.amount * (indexNow[proxy] / h.baseIndex));
}

// ---------------------------------------------------------------- 銘柄コード
// ティッカーや証券コードから銘柄名と種類を補完する。
// 全銘柄は載せられないので、よく持たれるものだけ。外れても手で直せる。

const SYMBOLS: Record<string, { name: string; klass: ClassId; coin?: string }> = {
  // 日本株（証券コード）
  "7203": { name: "トヨタ自動車", klass: "jp_stock" },
  "6758": { name: "ソニーグループ", klass: "jp_stock" },
  "9432": { name: "NTT", klass: "jp_stock" },
  "9433": { name: "KDDI", klass: "jp_stock" },
  "8306": { name: "三菱UFJフィナンシャル・グループ", klass: "jp_stock" },
  "8316": { name: "三井住友フィナンシャルグループ", klass: "jp_stock" },
  "8411": { name: "みずほフィナンシャルグループ", klass: "jp_stock" },
  "9984": { name: "ソフトバンクグループ", klass: "jp_stock" },
  "8058": { name: "三菱商事", klass: "jp_stock" },
  "8031": { name: "三井物産", klass: "jp_stock" },
  "6861": { name: "キーエンス", klass: "jp_stock" },
  "7974": { name: "任天堂", klass: "jp_stock" },
  "6501": { name: "日立製作所", klass: "jp_stock" },
  "7267": { name: "ホンダ", klass: "jp_stock" },
  "4502": { name: "武田薬品工業", klass: "jp_stock" },
  "4063": { name: "信越化学工業", klass: "jp_stock" },
  "8035": { name: "東京エレクトロン", klass: "jp_stock" },
  "6098": { name: "リクルートホールディングス", klass: "jp_stock" },
  "2914": { name: "日本たばこ産業", klass: "jp_stock" },
  "9101": { name: "日本郵船", klass: "jp_stock" },
  "1306": { name: "TOPIX連動型上場投信", klass: "jp_stock" },
  "1321": { name: "日経225連動型上場投信", klass: "jp_stock" },

  // 米国ETF・株（ティッカー）
  VOO: { name: "バンガード S&P500 ETF", klass: "us_stock" },
  VTI: { name: "バンガード 全米株式 ETF", klass: "us_stock" },
  VT: { name: "バンガード 全世界株式 ETF", klass: "us_stock" },
  VYM: { name: "バンガード 高配当株式 ETF", klass: "us_stock" },
  QQQ: { name: "インベスコ QQQ（ナスダック100）", klass: "us_stock" },
  SPY: { name: "SPDR S&P500 ETF", klass: "us_stock" },
  HDV: { name: "iShares 高配当株 ETF", klass: "us_stock" },
  SPYD: { name: "SPDR ポートフォリオ高配当株式 ETF", klass: "us_stock" },
  JEPI: { name: "JPモルガン 株式プレミアム・インカム ETF", klass: "us_stock" },
  AAPL: { name: "アップル", klass: "us_stock" },
  MSFT: { name: "マイクロソフト", klass: "us_stock" },
  NVDA: { name: "エヌビディア", klass: "us_stock" },
  GOOGL: { name: "アルファベット", klass: "us_stock" },
  AMZN: { name: "アマゾン", klass: "us_stock" },
  TSLA: { name: "テスラ", klass: "us_stock" },
  META: { name: "メタ", klass: "us_stock" },
  GLD: { name: "SPDR ゴールド・シェア", klass: "gold" },
  IAU: { name: "iShares ゴールド・トラスト", klass: "gold" },

  // 暗号資産。coin は units.coins のキーで、数量入力の単価に使う
  BTC: { name: "ビットコイン", klass: "crypto", coin: "btc" },
  ETH: { name: "イーサリアム", klass: "crypto", coin: "eth" },
  XRP: { name: "リップル", klass: "crypto", coin: "xrp" },
  SOL: { name: "ソラナ", klass: "crypto", coin: "sol" },
  DOGE: { name: "ドージコイン", klass: "crypto", coin: "doge" },
  ADA: { name: "カルダノ", klass: "crypto", coin: "ada" },
  BNB: { name: "BNB", klass: "crypto", coin: "bnb" },
  LTC: { name: "ライトコイン", klass: "crypto", coin: "ltc" },
  ビットコイン: { name: "ビットコイン", klass: "crypto", coin: "btc" },
  イーサリアム: { name: "イーサリアム", klass: "crypto", coin: "eth" },
  リップル: { name: "リップル", klass: "crypto", coin: "xrp" },

  // 投資信託の通称
  オルカン: { name: "eMAXIS Slim 全世界株式（オール・カントリー）", klass: "us_stock" },
  スリム米国: { name: "eMAXIS Slim 米国株式（S&P500）", klass: "us_stock" },
};

/** 入力された文字列がコード・ティッカーなら、銘柄名と種類を返す */
export function lookupSymbol(input: string): { name: string; klass: ClassId; coin?: string } | null {
  const s = input.trim();
  if (!s) return null;

  const hit = SYMBOLS[s] ?? SYMBOLS[s.toUpperCase()];
  if (hit) return hit;

  // 表に無い4桁の数字は、日本の証券コードとみなす
  if (/^\d{4}$/.test(s)) return { name: `${s}（日本株）`, klass: "jp_stock" };

  return null;
}

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

    // コード・ティッカーで書かれていれば銘柄名まで補完する
    const sym = lookupSymbol(name);
    const finalName = sym ? sym.name : name.slice(0, 40);
    const klass = sym ? sym.klass : guessClass(name);
    const allowed = CLASS_BY_ID[klass].accounts;

    out.push({
      key: Math.random().toString(36).slice(2, 10),
      name: finalName,
      klass,
      account: allowed.includes(account) ? account : allowed[0],
      mode: "amount",
      amount: Math.round(amount),
      qty: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------- ストレステスト
// 「もしこうなったら、いくら減るか」を金額で見せる。
// ここの数値は予測ではなく、過去に実際にあった下落局面を参考にした仮定。
// 断定を避けつつ、初心者が規模を実感できる粒度に丸めている。

export type Scenario = {
  id: string;
  name: string;
  detail: string;
  /** クラスごとの騰落（%）。書かれていないクラスは動かない扱い */
  impact: Partial<Record<ClassId, number>>;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "yen_up",
    name: "円高が10%進んだら",
    detail: "1ドル158円が142円ほどになる想定。ドルで持っているものは、中身が同じでも円に直すと目減りします。",
    impact: { us_stock: -10, fx: -10, gold: -10, crypto: -10 },
  },
  {
    id: "stock_down",
    name: "世界の株が20%下がったら",
    detail: "よくある調整局面の規模です。株と一緒に暗号資産はより大きく下げ、金は買われやすい傾向があります。",
    impact: { jp_stock: -20, us_stock: -20, crypto: -30, gold: 3 },
  },
  {
    id: "rate_up",
    name: "金利が急に上がったら",
    detail: "利息が付く預金や債券の魅力が増すため、利息を生まない資産から資金が抜けやすくなります。",
    impact: { jp_stock: -7, us_stock: -10, gold: -8, crypto: -15 },
  },
  {
    id: "crash",
    name: "2020年3月級の暴落が来たら",
    detail: "コロナショックの規模を想定。このときは安全資産とされる金も、現金化の売りで一時下げました。",
    impact: { jp_stock: -30, us_stock: -30, crypto: -50, gold: -5, fx: -5 },
  },
];

/** シナリオを当てたときの増減額（円）。値が動かないクラスは0として扱う */
export function applyScenario(byClass: Record<string, number>, sc: Scenario) {
  let delta = 0;
  const lines: { klass: ClassId; amount: number; pct: number }[] = [];

  for (const c of CLASSES) {
    const held = byClass[c.id] || 0;
    const pct = sc.impact[c.id];
    if (!held || pct === undefined) continue;
    const d = held * (pct / 100);
    delta += d;
    lines.push({ klass: c.id, amount: d, pct });
  }

  lines.sort((a, b) => a.amount - b.amount);
  return { delta, lines };
}

// ---------------------------------------------------------------- 表示補助

export const yen = (v: number) =>
  v >= 1e8
    ? `${(v / 1e8).toFixed(2)}億円`
    : v >= 1e4
      ? `${Math.round(v / 1e4).toLocaleString("ja-JP")}万円`
      : `${Math.round(v).toLocaleString("ja-JP")}円`;
