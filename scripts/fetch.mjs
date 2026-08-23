// ヨコグシ — データ取得スクリプト
//
// 6資産の日次終値を集め、相関行列まで計算して public/data/ に書き出す。
// GitHub Actions から定期実行する前提だが、手元でも `node scripts/fetch.mjs` で動く。
//
// APIキーが無い資産は自動でスキップされるので、キーを取るたびに資産が増えていく。

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
function judgeRegime(dayChange) {
  const eq = ["nikkei", "sp500"].map((id) => dayChange[id]).filter((v) => v !== undefined);
  const gold = dayChange.gold;
  if (eq.length === 0 || gold === undefined) return null;

  const e = mean(eq);
  const g = gold;
  const T = 0.3; // これ未満は「動いていない」とみなす（%）

  if (e > T && g < -T)
    return { label: "リスクオン", detail: "株が買われ、金が売られました。資金がリスクを取りにいった一日です。" };
  if (e < -T && g > T)
    return { label: "リスクオフ", detail: "株が売られ、金が買われました。資金が安全な置き場所に逃げています。" };
  if (e < -T && g < -T)
    return { label: "全面安", detail: "株も金も下がりました。逃げ場を探すというより、現金化が進んだ形です。" };
  if (e > T && g > T)
    return { label: "全面高", detail: "株も金も上がりました。お金の量そのものが増えているときに出やすい形です。" };
  return { label: "方向感なし", detail: "株も金も大きくは動いていません。様子見の一日です。" };
}

function buildHighlights({ live, ids, returnsById, corr30, corr365, asOf }) {
  const nameOf = (id) => live.find((a) => a.id === id)?.name ?? id;
  const items = [];

  // 直近1日の変化率（%）
  const dayChange = {};
  for (const id of ids) {
    const r = returnsById[id];
    dayChange[id] = r[r.length - 1] * 100;
  }

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
    regime: judgeRegime(dayChange),
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

  // --- latest.json : トップのカード用スナップショット
  const asOf = days[days.length - 1];
  const snapshot = live.map((a) => {
    const p = values[a.id];
    const last = p[p.length - 1];
    const pct = (back) => {
      const i = p.length - 1 - back;
      return i >= 0 && p[i] !== 0 ? Number(((last / p[i] - 1) * 100).toFixed(2)) : null;
    };
    // 年率換算の変動率。ポートフォリオのリスク試算に使う。
    // 日次のばらつき × √252（年間の営業日数）が慣例。
    const vol = stdev(returnsById[a.id].slice(-90)) * Math.sqrt(252) * 100;

    return {
      id: a.id, name: a.name, cls: a.cls, unit: a.unit,
      value: Number(last.toFixed(a.unit === "%" ? 3 : 2)),
      changeDay: pct(1), changeWeek: pct(5), changeMonth: pct(21),
      vol: Number(vol.toFixed(2)),
    };
  });

  // --- correlation.json : 期間別の相関行列
  const correlations = {
    asOf,
    windows: {
      d30:  correlationMatrix(ids, returnsById, 30),
      d90:  correlationMatrix(ids, returnsById, 90),
      d365: correlationMatrix(ids, returnsById, 365),
    },
  };

  // --- history.json : チャート用（年初=100に正規化）
  const history = {
    asOf,
    days,
    series: Object.fromEntries(
      ids.map((id) => {
        const p = values[id];
        const base = p[0];
        return [id, p.map((v) => Number(((v / base) * 100).toFixed(2)))];
      })
    ),
  };

  // --- highlights.json : 今日なにが普通と違ったかを文章にしたもの
  const highlights = buildHighlights({
    live,
    ids,
    returnsById,
    corr30: correlations.windows.d30,
    corr365: correlations.windows.d365,
    asOf,
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "latest.json"),
    JSON.stringify({ asOf, assets: snapshot, skipped: skipped.map((s) => s.id) }, null, 2));
  await writeFile(join(OUT_DIR, "correlation.json"), JSON.stringify(correlations, null, 2));
  await writeFile(join(OUT_DIR, "history.json"), JSON.stringify(history, null, 2));
  await writeFile(join(OUT_DIR, "highlights.json"), JSON.stringify(highlights, null, 2));

  console.log(`\n  今日のハイライト（自動生成）:`);
  if (highlights.regime) console.log(`    [${highlights.regime.label}] ${highlights.regime.detail}`);
  for (const it of highlights.items) console.log(`    ・${it.text}`);

  console.log(`\n  書き出し完了: public/data/ (${asOf} 時点)`);
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
