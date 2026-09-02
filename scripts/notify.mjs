// ヨコグシ — スマホの通知センターへ送る
//
// サイトを開かなくても今日の相場が分かるようにするためのもの。
// ヨコグシはサーバーを持たないので、送信は GitHub Actions のジョブが担う。
//
// 送り先は ntfy。購読情報を保存する必要がなく（トピック名を購読する仕組み）、
// VAPID鍵も要らないため、サーバーレスのまま通知だけを足せる。
//
// ヘッダに日本語を入れると配信側で文字化けすることがあるため、
// ヘッダではなく JSON の本文で送る（ntfy が公式に用意している方法）。
//
// NTFY_TOPIC が未設定なら何もせず正常終了する。手元での `npm run fetch` や
// フォークで落ちないようにするため。通知の失敗でデータ更新を道連れにしない。

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public", "data");
const STATE = join(DATA, "notified.json");
const SITE = "https://ruisma7715-lang.github.io/yokogushi/";

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* Actions 上では Secrets が環境変数で渡る */ }

const TOPIC = process.env.NTFY_TOPIC ?? "";
const SERVER = process.env.NTFY_SERVER ?? "https://ntfy.sh";

// 通知は幅が狭い。6資産の名前はここだけ短くする（画面の表記は変えない）。
const SHORT = {
  nikkei: "日経",
  sp500: "S&P",
  usdjpy: "ドル円",
  gold: "金",
  btc: "BTC",
  us10y: "米10年",
};

const readJSON = async (name) => JSON.parse(await readFile(join(DATA, name), "utf8"));

// 色を使えないので、向きは記号だけで示す（画面と同じ ▲▼ に揃える）
function pctText(v) {
  if (v === null || v === undefined) return "—";
  const mark = v > 0 ? "▲" : v < 0 ? "▼" : "―";
  return `${mark}${Math.abs(v).toFixed(2)}%`;
}

function valueText(a) {
  if (a.unit === "%") return `${a.value.toFixed(2)}%`;
  return a.value.toLocaleString("ja-JP", { maximumFractionDigits: a.value >= 1000 ? 0 : 2 });
}

function compose(latest, highlights, topics) {
  const [, m, d] = latest.asOf.split("-");
  const regime = highlights.regime?.label ?? "";
  const title = `ヨコグシ ${Number(m)}/${Number(d)}${regime ? ` · ${regime}` : ""}`;

  // 数字を先に置く。通知はまず一瞥されるので、文章より値が先に要る。
  const cells = latest.assets.map(
    (a) => `${SHORT[a.id] ?? a.name} ${valueText(a)} ${pctText(a.changeDay)}`
  );
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2).join("  /  "));

  // 文章は「今日の3行」の1行目と、米国・日本の市場からそれぞれ1行。
  // 全部入れると通知が長すぎて読まれない。
  const market = topics?.market ?? null;

  // 「今日の3行」の1行目は相場の姿勢から始まるが、それはタイトルに出している。
  // 通知は場所が狭いので、同じ語を2回出さない。
  let first = highlights.lead?.[0]?.text ?? "";
  if (regime && first.startsWith(`${regime}。`)) first = first.slice(regime.length + 1);

  const says = [first, market?.us?.lines?.[0], market?.jp?.lines?.[0]].filter(Boolean);

  const message = [...rows, "", ...says.map((s) => `・${s}`)].join("\n");
  return { title, message };
}

async function main() {
  // 送らずに文面だけ見る。届いてから直すのでは遅いので、先に目で確認できるようにする。
  //   node scripts/notify.mjs --dry
  const dry = process.argv.includes("--dry");

  if (!TOPIC && !dry) {
    console.log("  通知: NTFY_TOPIC が未設定のため送信しません");
    return;
  }

  const [latest, highlights, topics] = await Promise.all([
    readJSON("latest.json"),
    readJSON("highlights.json"),
    readJSON("topics.json").catch(() => null),
  ]);

  const { title, message } = compose(latest, highlights, topics);

  if (dry) {
    console.log(`  [送信せず] タイトル: ${title}`);
    for (const line of message.split("\n")) console.log(`    ${line}`);
    return;
  }

  // 休場日など、中身が前回とまったく同じなら送らない。
  // 同じ通知が繰り返し届くと、読まれなくなって通知そのものの意味が消える。
  const digest = createHash("sha256").update(`${title}\n${message}`).digest("hex").slice(0, 16);
  const prev = await readJSON("notified.json").catch(() => null);
  if (prev?.digest === digest) {
    console.log(`  通知: 前回と同じ内容のため送信しません（${prev.at}）`);
    return;
  }

  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: TOPIC,
      title,
      message,
      click: SITE, // 通知をタップしたらサイトが開く
      tags: ["chart_with_upwards_trend"],
      priority: 3,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`ntfy: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);

  await writeFile(
    STATE,
    JSON.stringify({ digest, at: new Date().toISOString(), asOf: latest.asOf }, null, 2)
  );

  console.log(`  通知を送信しました: ${title}`);
  for (const line of message.split("\n")) console.log(`    ${line}`);
}

// 通知が落ちても相場データの更新は成功させる。ここで exit 1 すると
// ワークフロー全体が赤くなり、データが更新されたのかどうか分からなくなる。
main().catch((err) => {
  console.log(`  !  通知の送信に失敗しました: ${err.message}`);
});
