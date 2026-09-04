// ヨコグシ — データ取得スクリプト
//
// 6資産の日次終値を集め、相関行列まで計算して public/data/ に書き出す。
// GitHub Actions から定期実行する前提だが、手元でも `node scripts/fetch.mjs` で動く。
//
// APIキーが無い資産は自動でスキップされるので、キーを取るたびに資産が増えていく。

import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDailyPage, renderIndex, renderSitemap, renderFeed, SITE_BASE } from "./daily-page.mjs";
import { fetchTopics } from "./topics.mjs";
import { fetchMarketInternals } from "./market.mjs";
import { buildConditional, describeFlow } from "./conditional.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "data");

// 手元では .env からキーを読む。GitHub Actions 上では .env が無く、
// 代わりに Secrets が環境変数として渡ってくるので、失敗しても無視してよい。
try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* .env が無ければ環境変数をそのまま使う */ }

const FRED_KEY = process.env.FRED_API_KEY ?? "";
const DAYS = 400; // 相関計算に使う期間（1年+α）

// ---------------------------------------------------------------- 資産の定義

const ASSETS = [
  { id: "nikkei", name: "日経平均",       cls: "JP EQUITY",  source: "fred",        code: "NIKKEI225", unit: "円"   },
  { id: "sp500",  name: "S&P 500",        cls: "US EQUITY",  source: "fred",        code: "SP500",     unit: "pt"   },
  { id: "usdjpy", name: "ドル円",         cls: "FX",         source: "frankfurter", code: "JPY",       unit: "円"   },
  { id: "gold",   name: "金",             cls: "COMMODITY",  source: "coingecko",   code: "pax-gold",  unit: "USD"  },
  { id: "btc",    name: "ビットコイン",   cls: "CRYPTO",     source: "coingecko",   code: "bitcoin",   unit: "USD"  },
  { id: "us10y",  name: "米10年債利回り", cls: "RATES",      source: "fred",        code: "DGS10",     unit: "%"    },
];

// ---------------------------------------------------------------- 小道具

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

async function getJSON(url, label) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- 各ソース
// どの取得関数も { "YYYY-MM-DD": 数値 } の形に揃えて返す。
// 形を揃えておくと、後段の処理がソースを一切気にしなくて済む。

async function fromFred(code) {
  if (!FRED_KEY) return null; // キーが無ければスキップ

  const start = isoDay(Date.now() - DAYS * 864e5);
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${code}&api_key=${FRED_KEY}&file_type=json&observation_start=${start}`;

  const json = await getJSON(url, `FRED ${code}`);
  const out = {};
  for (const o of json.observations ?? []) {
    // FREDは休場日を "." で返してくるので落とす
    if (o.value === "." || o.value === "") continue;
    const v = Number(o.value);
    if (Number.isFinite(v)) out[o.date] = v;
  }
  return out;
}

async function fromFrankfurter(code) {
  const start = isoDay(Date.now() - DAYS * 864e5);
  const end = isoDay(Date.now());
  const json = await getJSON(
    `https://api.frankfurter.app/${start}..${end}?from=USD&to=${code}`,
    `Frankfurter ${code}`
  );

  const out = {};
  for (const [day, rates] of Object.entries(json.rates ?? {})) {
    const v = rates?.[code];
    if (Number.isFinite(v)) out[day] = v;
  }
  return out;
}

async function fromCoinGecko(code) {
  const json = await getJSON(
    `https://api.coingecko.com/api/v3/coins/${code}/market_chart` +
      `?vs_currency=usd&days=365&interval=daily`,
    `CoinGecko ${code}`
  );

  const out = {};
  for (const [ms, price] of json.prices ?? []) {
    if (Number.isFinite(price)) out[isoDay(ms)] = price;
  }
  return out;
}

const FETCHERS = { fred: fromFred, frankfurter: fromFrankfurter, coingecko: fromCoinGecko };

// ---------------------------------------------------------------- 暗号資産の単価
//
// 相関を出す6資産にビットコインは入っているが、実際に持たれているのは
// それだけではない。数量から評価額を出すために、主要な通貨の円建て価格を配る。
// ここに1行足せば画面の選択肢が増える（画面側はこのデータを読むだけ）。
//
// step は入力欄の刻み。1枚が高いものほど細かく入れられる必要がある。
const COINS = [
  { key: "btc",  cg: "bitcoin",     ticker: "BTC",  name: "ビットコイン",   step: "0.00001" },
  { key: "eth",  cg: "ethereum",    ticker: "ETH",  name: "イーサリアム",   step: "0.0001"  },
  { key: "xrp",  cg: "ripple",      ticker: "XRP",  name: "リップル",       step: "1"       },
  { key: "sol",  cg: "solana",      ticker: "SOL",  name: "ソラナ",         step: "0.01"    },
  { key: "doge", cg: "dogecoin",    ticker: "DOGE", name: "ドージコイン",   step: "1"       },
  { key: "ada",  cg: "cardano",     ticker: "ADA",  name: "カルダノ",       step: "1"       },
  { key: "bnb",  cg: "binancecoin", ticker: "BNB",  name: "BNB",            step: "0.01"    },
  { key: "ltc",  cg: "litecoin",    ticker: "LTC",  name: "ライトコイン",   step: "0.01"    },
];

// 円建てで直接もらう。ドル建て×為替だと、為替の取得日と価格の日がずれる。
async function fetchCoinPrices() {
  const ids = COINS.map((c) => c.cg).join(",");
  const json = await getJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=jpy`,
    "CoinGecko 単価"
  );

  const out = {};
  for (const c of COINS) {
    const jpy = json[c.cg]?.jpy;
    if (!Number.isFinite(jpy)) continue;
    // 1円未満の通貨もあるので、丸め方を価格帯で変える
    out[c.key] = {
      ticker: c.ticker,
      name: c.name,
      step: c.step,
      jpy: jpy >= 100 ? Math.round(jpy) : Number(jpy.toFixed(4)),
    };
  }
  return out;
}

// ---------------------------------------------------------------- 相関

// 日次リターンの配列 a, b からピアソン相関係数を出す
function corr(a, b) {
  const n = a.length;
  if (n < 3) return null;

  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;

  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

// 全資産で値が揃っている日だけを残す。
// 揃っていない日を混ぜると相関がずれるので、ここは厳密にやる。
function alignSeries(seriesById) {
  const ids = Object.keys(seriesById);
  if (ids.length === 0) return { days: [], values: {} };

  let days = Object.keys(seriesById[ids[0]]);
  for (const id of ids.slice(1)) {
    const have = seriesById[id];
    days = days.filter((d) => d in have);
  }
  days.sort();

  const values = {};
  for (const id of ids) values[id] = days.map((d) => seriesById[id][d]);
  return { days, values };
}

const toReturns = (prices) =>
  prices.slice(1).map((p, i) => (prices[i] === 0 ? 0 : p / prices[i] - 1));

function correlationMatrix(ids, returnsById, window) {
  const matrix = {};
  for (const a of ids) {
    matrix[a] = {};
    for (const b of ids) {
      if (a === b) { matrix[a][b] = null; continue; } // 自分自身は表示しない
      const ra = returnsById[a].slice(-window);
      const rb = returnsById[b].slice(-window);
      const r = corr(ra, rb);
      matrix[a][b] = r === null ? null : Number(r.toFixed(3));
    }
  }
  return matrix;
}

// ---------------------------------------------------------------- 分析
// 数字を並べるだけでは読者は何も判断できないので、
// 「今日なにが普通と違ったか」をここで文章にしてしまう。

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const stdev = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

const signed = (v, digits = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(digits);

// 相関の強さを言葉にする。マトリクスの色分けと同じ境界を使う。
const relation = (r) =>
  r >= 0.6 ? "強く一緒に動く" : r >= 0.25 ? "ゆるく一緒に動く" : r > -0.25 ? "ほぼ無関係" : r > -0.6 ? "ゆるく逆に動く" : "強く逆に動く";

// 株と金がどちらに動いたかで、資金がリスクを取りに行ったか逃げたかが読める。
//
// ラベルは株と金の2つで決めるが、説明文は**その日に実際どこが動いたか**から書く。
// 以前は「資金が安全な置き場所に逃げています」といった固定文を出していたが、
// ビットコインもドル円も米10年債も見ずにそう書いていた。
// 行き先を確かめずに「逃げた」と書くのは、検証していないことを書いたことになる。
function judgeRegime(dayChange, live, us10yPt) {
  const eq = ["nikkei", "sp500"].map((id) => dayChange[id]).filter((v) => v !== undefined);
  const gold = dayChange.gold;
  if (eq.length === 0 || gold === undefined) return null;

  const e = mean(eq);
  const g = gold;
  const T = 0.3; // これ未満は「動いていない」とみなす（%）

  // 金はラベル側で必ず触れるので、説明文では重ねない
  const flow = (exclude) => describeFlow(dayChange, live, { exclude, us10yPt });

  if (e > T && g < -T)
    return { label: "リスクオン", detail: `株が買われ、金が売られました。同じ日に${flow(["gold"])}` };
  if (e < -T && g > T)
    return { label: "リスクオフ", detail: `株が売られ、金が買われました。同じ日に${flow(["gold"])}` };
  if (e < -T && g < -T)
    return { label: "全面安", detail: `株も金も下がりました。同じ日に${flow(["gold"])}` };
  if (e > T && g > T)
    return { label: "全面高", detail: `株も金も上がりました。同じ日に${flow(["gold"])}` };
  return { label: "方向感なし", detail: `株も金も大きくは動いていません。${flow([])}` };
}

// 何日続けて同じ方向に動いたか
function streakOf(returns) {
  const sign = Math.sign(returns[returns.length - 1] ?? 0);
  if (!sign) return { n: 0, sign: 0 };

  let n = 0;
  for (let i = returns.length - 1; i >= 0; i--) {
    if (Math.sign(returns[i]) !== sign) break;
    n++;
  }
  return { n, sign };
}

// 直近の値が「何営業日ぶりの高値／安値か」。
// 0 なら更新していない。252 を超えていれば 1年ぶり（52週高値・安値）。
function daysSinceBeyond(prices, dir) {
  const last = prices[prices.length - 1];
  let back = 0;
  for (let i = prices.length - 2; i >= 0; i--) {
    const beyond = dir > 0 ? prices[i] >= last : prices[i] <= last;
    if (beyond) break;
    back++;
  }
  return back;
}

// 「何日ぶり」を人が使う言葉に直す。短すぎる更新は記事にならないので null を返す。
function spanWord(days) {
  if (days >= 250) return { word: "1年ぶり", score: 75 };
  if (days >= 120) return { word: "半年ぶり", score: 60 };
  if (days >= 60) return { word: "3か月ぶり", score: 50 };
  if (days >= 20) return { word: "1か月ぶり", score: 35 };
  return null;
}

// ---------------------------------------------------------------- 今日の3行
//
// このサイトを毎日ひらく理由になるのは、数字そのものではなく
// 「今日は昨日と何が違うのか」が一言で分かることだと考えている。
// 毎日手で書くのが理想だが、書けない日ができた時点で更新は止まる。
// だから機械が毎日3行だけ書く。人が書いた日は、画面側でそちらを優先して見せる。
//
// 書き方の約束:
//   ・起きたことと、その事実が何に効くかまで。売買の推奨は絶対に書かない
//   ・「〜だろう」「〜すべき」を使わない。断定するのは観測できた事実だけ
function buildLead({ live, ids, values, returnsById, snapshot, regime, shifts, calendar, jstToday, asOf }) {
  const nameOf = (id) => live.find((a) => a.id === id)?.name ?? id;
  const snapOf = (id) => snapshot.find((a) => a.id === id);

  // 資産によって最新日が違う（米金利は数日遅れて公表される）。
  // 基準日と違うものだけ「いつの話か」を添える。黙って混ぜるのがいちばん良くない。
  const dateNote = (id) => {
    const s = snapOf(id);
    if (!s?.asOf || s.asOf === asOf) return "";
    const [, m, d] = s.asOf.split("-");
    return `（${Number(m)}/${Number(d)}時点）`;
  };

  // 文章の中に置く価格。桁が大きいものの小数点以下は読む邪魔にしかならない。
  const priceText = (s) => {
    const digits = s.unit === "%" ? 2 : Math.abs(s.value) >= 1000 ? 0 : 2;
    const num = s.value.toLocaleString("ja-JP", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    if (s.unit === "USD") return `${num}ドル`;
    return `${num}${s.unit}`;
  };

  const dayChange = {};
  for (const id of ids) {
    const r = returnsById[id];
    dayChange[id] = r[r.length - 1] * 100;
  }

  const moves = ids
    .map((id) => ({ id, chg: dayChange[id] }))
    .sort((x, y) => Math.abs(y.chg) - Math.abs(x.chg));

  const top = moves[0];
  const quiet = moves[moves.length - 1];

  // --- 1行目。その日の姿勢と、いちばん動いたもの。ここは必ず埋まる。
  const lines = [];
  if (top) {
    const dir = top.chg >= 0 ? "上昇" : "下落";

    // 姿勢の説明文（「株が買われ、金が売られました」）は画面側でバッジとして
    // 別に出しているので、ここでは繰り返さずラベルだけを添える。
    //
    // ただしラベルを添えるのは、姿勢の判定日とこの行の基準日が同じときだけ。
    // 姿勢は全資産が揃った日でしか出せず、この行は各資産の最新日で作るため、
    // 両者は1〜数日ずれることがある。ずれたまま繋ぐと
    // 「全面安。いちばん動いたのはビットコインで +4.89% の上昇でした」のような
    // 矛盾した文になる（実際に出た）。日付が違うなら値動きだけを書く。
    // 姿勢はバッジ側が自分の日付を添えて出しているので、情報は失われない。
    const sameDay = regime && (!regime.asOf || regime.asOf === asOf);

    lines.push({
      kind: "day",
      text:
        (sameDay ? `${regime.label}。` : "") +
        `いちばん動いたのは${nameOf(top.id)}${dateNote(top.id)}で、前日比 ${signed(top.chg)}% の${dir}でした。`,
    });
  }

  // --- 2行目以降の候補を集めて、点数の高いものから選ぶ
  const cand = [];

  // 普段と比べて異常な値動きだったか
  for (const m of moves) {
    const sd = stdev(returnsById[m.id].slice(-90)) * 100;
    if (!sd) continue;
    const z = Math.abs(m.chg) / sd;
    if (z < 1.8) continue;
    cand.push({
      kind: "unusual",
      about: m.id,
      score: 60 + z * 8,
      text: `${nameOf(m.id)}${dateNote(m.id)}のこの動きは、直近90日の平均的な振れ幅の ${z.toFixed(1)} 倍です。いつもの範囲を超えています。`,
    });
  }

  // 高値・安値の更新。相場の話題になりやすく、日によって主役が変わる。
  for (const id of ids) {
    const p = values[id];
    const s = snapOf(id);
    if (!p || !s) continue;

    for (const dir of [1, -1]) {
      const span = spanWord(daysSinceBeyond(p, dir));
      if (!span) continue;
      const kindWord = dir > 0 ? "高値" : "安値";
      cand.push({
        kind: "milestone",
        about: id,
        score: span.score,
        text: `${nameOf(id)}は ${priceText(s)} と、${span.word}の${kindWord}です${dateNote(id)}。`,
      });
    }
  }

  // 連続記録。1日の値動きが小さくても、積み上がると効いてくる。
  for (const id of ids) {
    const { n, sign } = streakOf(returnsById[id]);
    if (n < 4) continue;
    const s = snapOf(id);
    const word = sign > 0 ? "続伸" : "続落";
    const total = s?.changeWeek;
    cand.push({
      kind: "streak",
      about: id,
      score: 30 + n * 5,
      text:
        `${nameOf(id)}は ${n}日${word}${dateNote(id)}。` +
        (typeof total === "number" ? `この1週間で ${signed(total)}% です。` : ""),
    });
  }

  // 資産どうしの関係の変化。このサイトの核心なので、少し高めに評価する。
  const big = shifts[0];
  if (big && Math.abs(big.diff) >= 0.25) {
    const flipped = relation(big.now) !== relation(big.base);
    cand.push({
      kind: "shift",
      // 2資産の「関係」の話なので、1行目と同じ資産が出てきても外さない。
      // このサイトで唯一よそに無い視点なので、落とすと3行が痩せる。
      about: null,
      score: 45 + Math.abs(big.diff) * 40,
      text:
        `${nameOf(big.a)}と${nameOf(big.b)}の関係が動いています。` +
        `1年では ${signed(big.base)}（${relation(big.base)}）、直近30日は ${signed(big.now)}（${relation(big.now)}）。` +
        (flipped ? "前提が入れ替わりました。" : "同じ方向への寄りが強まっています。"),
    });
  }

  // 1週間・1ヶ月の大きな変化。1日では見えない流れを拾う。
  for (const s of snapshot) {
    if (typeof s.changeWeek === "number" && Math.abs(s.changeWeek) >= 4) {
      cand.push({
        kind: "span",
        about: s.id,
        score: 35 + Math.abs(s.changeWeek),
        text: `${s.name}${dateNote(s.id)}はこの1週間で ${signed(s.changeWeek)}%。1ヶ月では ${s.changeMonth == null ? "—" : signed(s.changeMonth) + "%"} です。`,
      });
    }
  }

  // これから発表される米指標。明日また見にくる理由になる唯一の材料。
  const tomorrow = new Date(Date.parse(`${jstToday}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  for (const c of calendar) {
    if (c.date === jstToday) {
      cand.push({
        kind: "calendar",
        about: null,
        score: 42,
        text: `今夜は${c.name}の発表日です。${c.why}ため、明日の相場の前提が変わることがあります。`,
      });
    } else if (c.date === tomorrow) {
      cand.push({
        kind: "calendar",
        about: null,
        score: 38,
        text: `明日は${c.name}の発表があります。${c.why}指標です。`,
      });
    }
  }

  // 静かな日ほど埋まらないので、最後に必ず使える札を用意しておく
  if (quiet) {
    cand.push({
      kind: "calm",
      about: quiet.id,
      score: 10,
      text: `いちばん静かだったのは${nameOf(quiet.id)}${dateNote(quiet.id)}で、前日比 ${signed(quiet.chg)}% でした。`,
    });
  }

  cand.sort((a, b) => b.score - a.score);

  // 同じ切り口・同じ資産の話が続くと3行が痩せるので、種類と資産を散らす
  const usedKind = new Set();
  const usedAbout = new Set(top ? [top.id] : []);

  for (const c of cand) {
    if (lines.length >= 3) break;
    if (usedKind.has(c.kind)) continue;
    // 点数が高いものは、1行目と同じ資産の話でも通す
    if (c.about && usedAbout.has(c.about) && c.score < 60) continue;

    lines.push({ kind: c.kind, text: c.text });
    usedKind.add(c.kind);
    if (c.about) usedAbout.add(c.about);
  }

  return lines.slice(0, 3);
}

function buildHighlights({ live, ids, returnsById, levels, corr30, corr365, asOf }) {
  const nameOf = (id) => live.find((a) => a.id === id)?.name ?? id;
  const items = [];

  // 直近1日の変化率（%）
  const dayChange = {};
  for (const id of ids) {
    const r = returnsById[id];
    dayChange[id] = r[r.length - 1] * 100;
  }

  // 米10年債だけは「利回りが何%上がったか」ではなく「何ポイント動いたか」で読まれる。
  // dayChange は他資産と揃えて変化率で持っているので、差は水準から別に出す。
  let us10yPt;
  const y = levels?.us10y;
  if (y && y.length >= 2) us10yPt = y[y.length - 1] - y[y.length - 2];

  // 1) いちばん大きく動いたもの
  const moves = ids
    .map((id) => ({ id, chg: dayChange[id] }))
    .sort((x, y) => Math.abs(y.chg) - Math.abs(x.chg));

  if (moves.length) {
    items.push({
      kind: "move",
      text: `最も大きく動いたのは${nameOf(moves[0].id)}で、前日比 ${signed(moves[0].chg)}% でした。`,
    });
  }

  // 2) 普段と比べて異常な動きだったか（直近90日のばらつきの何倍か）
  for (const m of moves) {
    const sd = stdev(returnsById[m.id].slice(-90)) * 100;
    if (!sd) continue;
    const z = Math.abs(m.chg) / sd;
    if (z >= 2) {
      items.push({
        kind: "unusual",
        text: `${nameOf(m.id)}のこの動きは、直近90日の平均的な変動幅の ${z.toFixed(1)} 倍です。通常の範囲を超えています。`,
      });
      break; // いちばん目立つ1件だけで十分
    }
  }

  // 3) 資産どうしの関係が変わっていないか。
  //    1年の姿を「平常時」とみなし、直近30日とのズレを探す。ここがこのサイトの核心。
  const shifts = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const now = corr30[a]?.[b];
      const base = corr365[a]?.[b];
      if (typeof now !== "number" || typeof base !== "number") continue;
      shifts.push({ a, b, now, base, diff: Number((now - base).toFixed(3)) });
    }
  }
  shifts.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  const big = shifts[0];
  if (big && Math.abs(big.diff) >= 0.3) {
    const flipped = relation(big.now) !== relation(big.base);
    items.push({
      kind: "shift",
      text:
        `${nameOf(big.a)}と${nameOf(big.b)}の関係が変わっています。` +
        `1年では ${signed(big.base)}（${relation(big.base)}）でしたが、直近30日は ${signed(big.now)}（${relation(big.now)}）。` +
        (flipped ? "前提が入れ替わりました。" : "関係が強まっています。"),
    });
  }

  return {
    asOf,
    regime: judgeRegime(dayChange, live, us10yPt),
    items,
    shifts: shifts.slice(0, 6),
  };
}

// ---------------------------------------------------------------- 本体

async function main() {
  console.log("ヨコグシ データ取得\n");

  const seriesById = {};
  const live = [];
  const skipped = [];

  for (const asset of ASSETS) {
    try {
      const series = await FETCHERS[asset.source](asset.code);

      if (series === null) {
        skipped.push({ ...asset, reason: "APIキー未設定" });
        console.log(`  -  ${asset.name.padEnd(14, "　")} スキップ（${asset.source.toUpperCase()} のキーが未設定）`);
        continue;
      }
      if (Object.keys(series).length < 30) {
        skipped.push({ ...asset, reason: "データ不足" });
        console.log(`  !  ${asset.name.padEnd(14, "　")} データ不足`);
        continue;
      }

      seriesById[asset.id] = series;
      live.push(asset);
      console.log(`  OK ${asset.name.padEnd(14, "　")} ${Object.keys(series).length} 日分`);

      await sleep(1500); // 無料枠のレート制限に配慮
    } catch (err) {
      skipped.push({ ...asset, reason: err.message });
      console.log(`  X  ${asset.name.padEnd(14, "　")} 失敗: ${err.message}`);
    }
  }

  if (live.length === 0) throw new Error("取得できた資産がありません");

  const ids = live.map((a) => a.id);
  const { days, values } = alignSeries(seriesById);
  console.log(`\n  全資産で値が揃った日: ${days.length} 日`);

  if (days.length < 30) throw new Error("共通する営業日が少なすぎます");

  const returnsById = {};
  for (const id of ids) returnsById[id] = toReturns(values[id]);

  // 相関は「全資産の値が揃った日」でしか計算できない。
  // だがカードに出す現在値まで、いちばん遅いソースに合わせる必要はない。
  // 揃うのを待つと表示が常に2〜4営業日前になり、開いても「今の相場」に見えなくなる。
  // そこで、横断の分析は共通日（alignedAsOf）、現在値は資産ごとの最新日（ownAsOf）と分ける。
  const ownDays = {};
  const ownValues = {};
  const ownReturns = {};
  for (const id of ids) {
    const d = Object.keys(seriesById[id]).sort();
    ownDays[id] = d;
    ownValues[id] = d.map((day) => seriesById[id][day]);
    ownReturns[id] = toReturns(ownValues[id]);
  }

  const alignedAsOf = days[days.length - 1];
  const latestAsOf = ids
    .map((id) => ownDays[id][ownDays[id].length - 1])
    .sort()
    .pop();

  console.log(`  最新の値が取れた日: ${latestAsOf}（相関の計算は ${alignedAsOf} まで）`);
  for (const id of ids) {
    const own = ownDays[id][ownDays[id].length - 1];
    if (own !== latestAsOf) {
      console.log(`    ${live.find((a) => a.id === id).name} は ${own} 時点`);
    }
  }

  // --- スナップショット。同じ作り方で「資産ごとの最新」と「共通日」の2つを作る。
  //     前者はトップのカード用、後者はその日1本ぶんの日次ページ用。
  const makeSnapshot = (valuesById, retById, asOfOf) =>
    live.map((a) => {
      const p = valuesById[a.id];
      const last = p[p.length - 1];
      const pct = (back) => {
        const i = p.length - 1 - back;
        return i >= 0 && p[i] !== 0 ? Number(((last / p[i] - 1) * 100).toFixed(2)) : null;
      };
      // 年率換算の変動率。ポートフォリオのリスク試算に使う。
      // 日次のばらつき × √252（年間の営業日数）が慣例。
      const vol = stdev(retById[a.id].slice(-90)) * Math.sqrt(252) * 100;

      return {
        id: a.id, name: a.name, cls: a.cls, unit: a.unit,
        asOf: asOfOf(a.id),
        value: Number(last.toFixed(a.unit === "%" ? 3 : 2)),
        changeDay: pct(1), changeWeek: pct(5), changeMonth: pct(21),
        vol: Number(vol.toFixed(2)),
      };
    });

  const snapshot = makeSnapshot(ownValues, ownReturns, (id) => ownDays[id][ownDays[id].length - 1]);
  const snapshotAligned = makeSnapshot(values, returnsById, () => alignedAsOf);

  // --- 単価。数量だけ入れれば円建ての評価額が出せるようにするため。
  //     個別株の現在価格は無料で取れないが、この3つは取れるので数量入力に対応できる。
  //     ここも各資産の最新値を使う（円換算はいまの値でないと意味がない）。
  const px = (id) => {
    const p = ownValues[id];
    return p ? p[p.length - 1] : null;
  };
  const usdjpy = px("usdjpy");
  const goldUsdPerOz = px("gold"); // PAXG は 1トークン = 金1トロイオンス
  const btcUsd = px("btc");
  const TROY_OZ_G = 31.1035;

  // ビットコイン以外の暗号資産の単価。取れなくても他の入力は成立するので止めない。
  let coins = {};
  try {
    coins = await fetchCoinPrices();
    console.log(`  暗号資産の単価: ${Object.keys(coins).length} 銘柄`);
  } catch (err) {
    console.log(`  !  暗号資産の単価を取得できませんでした: ${err.message}`);
  }

  const units = {
    usd_jpy: usdjpy ? Number(usdjpy.toFixed(2)) : null,
    btc_jpy: btcUsd && usdjpy ? Math.round(btcUsd * usdjpy) : null,
    gold_jpy_per_g:
      goldUsdPerOz && usdjpy ? Math.round((goldUsdPerOz / TROY_OZ_G) * usdjpy) : null,
    coins,
  };

  // --- correlation.json : 期間別の相関行列
  const correlations = {
    asOf: alignedAsOf,
    windows: {
      d30:  correlationMatrix(ids, returnsById, 30),
      d90:  correlationMatrix(ids, returnsById, 90),
      d365: correlationMatrix(ids, returnsById, 365),
    },
  };

  // --- history.json : チャート用（年初=100に正規化）
  const history = {
    asOf: alignedAsOf,
    days,
    series: Object.fromEntries(
      ids.map((id) => {
        const p = values[id];
        const base = p[0];
        return [id, p.map((v) => Number(((v / base) * 100).toFixed(2)))];
      })
    ),
  };

  // --- attribution.json : 「なぜ増えた・減ったか」を分解するための素材。
  //     日次リターンをそのまま渡し、配分を掛ける計算は画面側で行う
  //     （保有内容はブラウザの外に出さないため、サーバー側では計算できない）。
  //
  //     現地通貨の値動きと為替を分けて渡すのが肝。
  //     日本人がS&P500を持つと「米国株の値動き」と「円高・円安」の2つが効くが、
  //     これを分けないと「なぜ減ったか」が説明できない。
  const pctSeries = (id) =>
    (returnsById[id] ?? []).map((v) => Number((v * 100).toFixed(4)));

  const attribution = {
    asOf: alignedAsOf,
    days: days.slice(1), // リターンは前日比なので1日短い
    local: Object.fromEntries(ids.map((id) => [id, pctSeries(id)])),
    fx: pctSeries("usdjpy"),
    // 現地通貨がドルのもの。円換算では、ここに為替の影響が上乗せされる
    usdBased: ["sp500", "gold", "btc"].filter((id) => ids.includes(id)),
  };

  // --- highlights.json : 今日なにが普通と違ったかを文章にしたもの
  const highlights = buildHighlights({
    live,
    ids,
    returnsById,
    levels: values, // 利回りの「差」を出すために水準そのものが要る
    corr30: correlations.windows.d30,
    corr365: correlations.windows.d365,
    asOf: alignedAsOf,
  });

  // --- conditional.json : こういう日は、どうなるか。
  //     相関マトリクスは全部の日を平均した数字なので、「株が売られた日に
  //     金はどうだったか」には答えられない。平均に埋もれる話をここで拾う。
  //     横断の分析なので、基準日は当然 alignedAsOf。
  const conditional = buildConditional({ live, ids, days, values, asOf: alignedAsOf });

  // --- topics.json : 今日のトピックス（公式RSSの見出し＋米指標の発表予定）
  //     外部サイト頼みなので、落ちてもデータ本体の更新は止めない。
  const jstToday = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  let topics = { generatedAt: new Date().toISOString(), today: jstToday, calendar: [], headlines: [], failed: [] };
  try {
    topics = await fetchTopics({ fredKey: FRED_KEY });
    if (topics.failed.length) console.log(`\n  トピックス取得の失敗: ${topics.failed.join(" / ")}`);
  } catch (err) {
    console.log(`\n  !  トピックス取得に失敗: ${err.message}`);
  }

  // --- 今日の市場。カードに出す6資産とは別に、米株の内訳を集めて事実を文にする。
  //     指数を1本見ても「大型ハイテクだけが買われた日」と「全部そろって上げた日」の
  //     区別がつかないため。すでに取れている系列は渡して、二重に叩かない。
  //     ここも落ちてよい。市場の内訳が無くてもトピックスと相場データは成立する。
  try {
    const market = await fetchMarketInternals({
      fredKey: FRED_KEY,
      known: { nikkei: seriesById.nikkei, sp500: seriesById.sp500, usdjpy: seriesById.usdjpy },
    });
    topics.market = market;
    if (market.failed.length) console.log(`  今日の市場の取得失敗: ${market.failed.join(" / ")}`);
  } catch (err) {
    topics.market = null;
    console.log(`  !  今日の市場の取得に失敗: ${err.message}`);
  }

  // 相場の姿勢（リスクオン・オフ）は、全資産が同じ日に動いた結果を比べないと出せない。
  // 共通日の判定であることが分かるよう、日付を添えておく。
  if (highlights.regime) highlights.regime.asOf = alignedAsOf;
  highlights.asOf = latestAsOf;

  // --- 今日の3行。トップ用は各資産の最新値から、日次ページ用は共通日から作る。
  //     同じ関数に別のデータを渡すだけなので、書き方の癖は揃う。
  highlights.lead = buildLead({
    live,
    ids,
    values: ownValues,
    returnsById: ownReturns,
    snapshot,
    regime: highlights.regime,
    shifts: highlights.shifts,
    calendar: topics.calendar,
    jstToday,
    asOf: latestAsOf,
  });

  // 日次ページはその日1本ぶんの記録なので、日付をまたいだ値を混ぜない
  const highlightsAligned = {
    ...highlights,
    asOf: alignedAsOf,
    lead: buildLead({
      live,
      ids,
      values,
      returnsById,
      snapshot: snapshotAligned,
      regime: highlights.regime,
      shifts: highlights.shifts,
      calendar: topics.calendar,
      jstToday,
      asOf: alignedAsOf,
    }),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "topics.json"), JSON.stringify(topics, null, 2));
  await writeFile(join(OUT_DIR, "latest.json"),
    JSON.stringify(
      { asOf: latestAsOf, alignedAsOf, assets: snapshot, units, skipped: skipped.map((s) => s.id) },
      null,
      2
    ));
  await writeFile(join(OUT_DIR, "correlation.json"), JSON.stringify(correlations, null, 2));
  await writeFile(join(OUT_DIR, "history.json"), JSON.stringify(history, null, 2));
  await writeFile(join(OUT_DIR, "highlights.json"), JSON.stringify(highlights, null, 2));
  await writeFile(join(OUT_DIR, "attribution.json"), JSON.stringify(attribution, null, 2));
  if (conditional) {
    await writeFile(join(OUT_DIR, "conditional.json"), JSON.stringify(conditional, null, 2));
  }

  // --- 日次の解説ページ。実行のたびに1本ずつ増え、検索の入口になる。
  const DAILY_DIR = join(ROOT, "public", "daily");
  await mkdir(DAILY_DIR, { recursive: true });

  const existing = (await readdir(DAILY_DIR).catch(() => []))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map((f) => f.replace(".html", ""));

  const allDays = [...new Set([...existing, alignedAsOf])].sort();
  const at = allDays.indexOf(alignedAsOf);

  const page = renderDailyPage({
    asOf: alignedAsOf,
    snapshot: snapshotAligned,
    highlights: highlightsAligned,
    topics,
    prevDay: at > 0 ? allDays[at - 1] : null,
    nextDay: at < allDays.length - 1 ? allDays[at + 1] : null,
  });

  await writeFile(join(DAILY_DIR, `${alignedAsOf}.html`), page.html);
  await writeFile(join(DAILY_DIR, "index.html"), renderIndex([...allDays].reverse()));
  await writeFile(join(ROOT, "public", "sitemap.xml"), renderSitemap(allDays));
  await writeFile(
    join(ROOT, "public", "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_BASE}/sitemap.xml\n`
  );

  // --- feed.xml : 更新を追う手段を、こちらが用意した経路に縛らないために出す。
  //     見出しと要約は書き出し済みの日次HTMLから拾う。そのために別のJSONを
  //     持つと、ページとフィードで中身がずれたときにどちらが正しいか分からなくなる。
  //     正規表現は文字列から組み立てない（この環境ではエスケープが潰れて静かに空振りする）。
  const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
  const OGDESC_RE = /<meta property="og:description" content="([^"]*)"/i;
  const unesc = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");

  const feedDays = [...allDays].reverse().slice(0, 30);
  const entries = [];
  for (const day of feedDays) {
    try {
      const html = await readFile(join(DAILY_DIR, `${day}.html`), "utf8");
      const rawTitle = unesc(html.match(TITLE_RE)?.[1] ?? "");
      const summary = unesc(html.match(OGDESC_RE)?.[1] ?? "");
      entries.push({
        day,
        // ページのtitleは検索向けに長い。フィードでは「｜」より前だけにする
        title: (rawTitle.split("｜")[0] || `${day}のマーケット`).trim(),
        summary,
      });
    } catch {
      // 消えたページがあってもフィード全体は出す
    }
  }

  if (entries.length) {
    await writeFile(
      join(ROOT, "public", "feed.xml"),
      renderFeed(entries, new Date().toISOString())
    );
  }

  console.log(`\n  日次ページ: ${allDays.length} 本（最新 ${alignedAsOf}）／ フィード ${entries.length} 件`);

  console.log(`\n  今日の3行（自動生成）:`);
  highlights.lead.forEach((l, i) => console.log(`    ${i + 1}. ${l.text}`));

  // 市場の内訳は型チェックが効かない（scripts は tsconfig の include の外）。
  // 出力を目で見ることが唯一の検証なので、必ず標準出力に出す。
  if (topics.market?.us) {
    const m = topics.market;
    // 全角は2桁ぶんの幅を取るので、padEnd では揃わない（見た目だけの話だが、
    // この出力が唯一の検証手段なので読みにくいと確認にならない）
    const width = (s) => [...s].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? 1 : 2), 0);
    const padName = (s) => s + " ".repeat(Math.max(0, 18 - width(s)));

    console.log(`\n  今日の市場（米国 ${m.us.asOf}${m.jp ? ` / 日本 ${m.jp.asOf}` : ""}）:`);
    for (const x of m.us.indices) {
      const d = x.changeDay === null ? "—" : `${x.changeDay > 0 ? "+" : ""}${x.changeDay}%`;
      console.log(`    ${padName(x.name)}${String(x.value).padStart(10)}  ${d}`);
    }
    if (m.us.vix) console.log(`    ${padName("VIX")}${String(m.us.vix.value).padStart(10)}  60日平均 ${m.us.vix.avg60}`);
    for (const line of [...m.us.lines, ...(m.jp?.lines ?? [])]) console.log(`    ・${line}`);
  }

  // こういう日はどうなるか。scripts は型チェックの対象外なので、
  // 出力を目で見ることが唯一の検証になる。全条件ぶん出す。
  if (conditional) {
    console.log(`\n  こういう日は、どうなるか（母数 ${conditional.window.days} 日）:`);
    for (const c of conditional.conditions) {
      if (!c.enough) {
        console.log(`    ${c.label}  該当 ${c.n} 日 → 少なすぎるので数字を出さない`);
        continue;
      }
      const line = ids
        .map((id) => {
          const a = c.assets[id];
          const nm = live.find((x) => x.id === id).name;
          return `${nm} ${a.mean > 0 ? "+" : ""}${a.mean}${a.unit}(${a.upRate}%)`;
        })
        .join(" / ");
      console.log(`    ${c.label}  該当 ${c.n} 日`);
      console.log(`      ${line}`);
    }
  }

  console.log(`\n  トピックス: 発表予定 ${topics.calendar.length}件 / 見出し ${topics.headlines.length}件`);
  for (const c of topics.calendar.slice(0, 3)) console.log(`    ${c.date}  ${c.name}`);
  for (const h of topics.headlines.slice(0, 3)) console.log(`    ${h.source}  ${h.title}`);

  console.log(`\n  書き出し完了: public/data/ (現在値 ${latestAsOf} / 相関 ${alignedAsOf} 時点)`);
  console.log(`  稼働中: ${live.map((a) => a.name).join(" / ")}`);
  if (skipped.length) console.log(`  未稼働: ${skipped.map((s) => s.name).join(" / ")}`);

  // 相関のサンプルを標準出力にも出しておくと、動作確認が早い
  if (ids.length >= 2) {
    console.log("\n  相関（直近90日）:");
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const r = correlations.windows.d90[ids[i]][ids[j]];
        const na = live.find((a) => a.id === ids[i]).name;
        const nb = live.find((a) => a.id === ids[j]).name;
        console.log(`    ${na} × ${nb}: ${r === null ? "—" : r > 0 ? "+" + r.toFixed(2) : r.toFixed(2)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("\n失敗:", err.message);
  process.exit(1);
});
