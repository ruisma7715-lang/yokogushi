// ヨコグシ — 購読者へ Web Push を送る
//
// 通知の文面は notify.mjs（ntfy = 自分ひとり用）と同じ考え方で作るが、
// 宛先が違う。こちらは購読ボタンを押した訪問者ぜんぶ。
//
// 購読情報は Cloudflare Worker（worker/）の KV にあり、ここから読み出す。
// 暗号化と VAPID 署名は web-push に任せる。RFC 8291 を自前で書くと、
// 間違っていても「届かない」としか分からず、原因を追えない。
//
// 必要な環境変数（どれか欠けたら何もせず正常終了する）
//   PUSH_WORKER_URL      … 受け口の URL
//   PUSH_ADMIN_TOKEN     … 一覧と削除に使うトークン
//   VAPID_PRIVATE_KEY    … VAPID の秘密鍵
//   VAPID_PUBLIC_KEY     … VAPID の公開鍵

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public", "data");
const SITE = "https://ruisma7715-lang.github.io/yokogushi/";

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* Actions では Secrets が環境変数で渡る */ }

const WORKER = (process.env.PUSH_WORKER_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.PUSH_ADMIN_TOKEN ?? "";
const PRIV = process.env.VAPID_PRIVATE_KEY ?? "";
const PUB = process.env.VAPID_PUBLIC_KEY ?? "";

const readJSON = async (name) => JSON.parse(await readFile(join(DATA, name), "utf8"));

const SHORT = { nikkei: "日経", sp500: "S&P", usdjpy: "ドル円", gold: "金", btc: "BTC", us10y: "米10年" };

function pctText(v) {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "▲" : v < 0 ? "▼" : "―"}${Math.abs(v).toFixed(2)}%`;
}

function valueText(a) {
  if (a.unit === "%") return `${a.value.toFixed(2)}%`;
  return a.value.toLocaleString("ja-JP", { maximumFractionDigits: a.value >= 1000 ? 0 : 2 });
}

/**
 * 通知の中身。ntfy 版より短くする。
 * 通知センターに出る行数が限られるうえ、こちらは相手が訪問者なので、
 * 「今日はどうだったか」が一目で分かることを優先する。
 */
function compose(latest, highlights, topics) {
  const [, m, d] = latest.asOf.split("-");
  const regime = highlights.regime?.label ?? "";
  const title = `ヨコグシ ${Number(m)}/${Number(d)}${regime ? ` · ${regime}` : ""}`;

  const cells = latest.assets.map((a) => `${SHORT[a.id] ?? a.name} ${valueText(a)} ${pctText(a.changeDay)}`);
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2).join("  /  "));

  let first = highlights.lead?.[0]?.text ?? "";
  if (regime && first.startsWith(`${regime}。`)) first = first.slice(regime.length + 1);

  const market = topics?.market ?? null;
  const says = [first, market?.us?.lines?.[0]].filter(Boolean);

  return { title, body: [...rows, "", ...says].join("\n"), url: SITE };
}

async function main() {
  if (!WORKER || !TOKEN || !PRIV || !PUB) {
    console.log("  Web Push: 設定が揃っていないため送信しません（受け口が未デプロイ）");
    return;
  }

  webpush.setVapidDetails(SITE, PUB, PRIV);

  const res = await fetch(`${WORKER}/subscriptions`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`購読の取得に失敗: HTTP ${res.status}`);

  const { subscriptions } = await res.json();
  if (!subscriptions?.length) {
    console.log("  Web Push: 購読者がいません");
    return;
  }

  const [latest, highlights, topics] = await Promise.all([
    readJSON("latest.json"),
    readJSON("highlights.json"),
    readJSON("topics.json").catch(() => null),
  ]);

  const payload = JSON.stringify(compose(latest, highlights, topics));

  let sent = 0;
  const gone = [];

  // 1人が失敗しても他は送る。allSettled で全部走らせてから結果を数える。
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 12 * 3600 })
    )
  );

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
      return;
    }
    // 404 / 410 は「その購読はもう存在しない」。放置すると毎回送り続けることになる。
    const code = r.reason?.statusCode;
    if (code === 404 || code === 410) gone.push(subscriptions[i].key);
    else console.log(`  !  送信できなかった宛先が1件（${code ?? r.reason?.message}）`);
  });

  if (gone.length) {
    await fetch(`${WORKER}/prune`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ keys: gone }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => undefined);
  }

  console.log(`  Web Push: ${sent}/${subscriptions.length} 件に送信${gone.length ? `（無効な購読 ${gone.length} 件を削除）` : ""}`);
}

// 通知が落ちても相場データの更新は成功させる。notify.mjs と同じ方針。
main().catch((err) => {
  console.log(`  !  Web Push の送信に失敗しました: ${err.message}`);
});
