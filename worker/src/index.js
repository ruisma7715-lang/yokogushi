// ヨコグシ — 購読情報の受け口（Cloudflare Worker）
//
// なぜこれが要るか。
// ヨコグシは静的サイトなので、ブラウザが作った購読情報（endpoint と鍵）を
// 受け取って保存する場所が無い。Web Push はこれが無いと成立しない。
// リポジトリにコミットする案は、公開リポジトリに訪問者の識別子を並べることに
// なるので取らない（保有内容を localStorage から出さない方針と食い違う）。
//
// 保存先は Workers KV。通知の送信自体はここではやらない。
// 送信は GitHub Actions が web-push で行う（VAPID署名とペイロード暗号化を
// 自前で書くより、実績のあるライブラリに任せるほうが安全）。
//
//   POST /subscribe     購読を登録        （誰でも）
//   POST /unsubscribe   購読を解除        （誰でも。自分の endpoint のみ）
//   GET  /subscriptions 購読の一覧        （ADMIN_TOKEN が要る）
//   POST /prune         無効な購読を削除  （ADMIN_TOKEN が要る）

const SITE = "https://ruisma7715-lang.github.io";

// 購読の endpoint は各ブラウザのプッシュサービスを指す。ここに無いホストは受け付けない。
// 誰でも POST できる口なので、でたらめな値で KV が埋まるのを防ぐ。
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome / Edge / Android
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari / iOS
  "notify.windows.com",
  "wns2-.*.notify.windows.com",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") ?? "";
  // 自分のサイトからだけ。ワイルドカードにすると、どのページからでも登録できてしまう。
  const allow = origin === SITE ? SITE : "";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
  };
}

const json = (data, status, request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });

const empty = (status, request) => new Response(null, { status, headers: corsHeaders(request) });

/** endpoint から KV のキーを作る。endpoint そのものは長すぎ、文字も使えない */
async function keyFor(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string") return false;
  if (sub.endpoint.length > 1000) return false;

  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!PUSH_HOSTS.some((h) => new RegExp(`^${h}$`).test(url.hostname))) return false;

  const k = sub.keys;
  if (!k || typeof k.p256dh !== "string" || typeof k.auth !== "string") return false;
  if (k.p256dh.length > 200 || k.auth.length > 100) return false;

  return true;
}

const authorized = (request, env) =>
  !!env.ADMIN_TOKEN && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return empty(204, request);

    // --- 購読の登録。訪問者のブラウザから直接呼ばれる。
    if (url.pathname === "/subscribe" && request.method === "POST") {
      let sub;
      try {
        sub = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400, request);
      }
      if (!validSubscription(sub)) return json({ error: "invalid subscription" }, 400, request);

      await env.SUBS.put(
        await keyFor(sub.endpoint),
        JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          at: new Date().toISOString(),
        })
      );
      return empty(204, request);
    }

    // --- 購読の解除。
    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400, request);
      }
      if (typeof body?.endpoint !== "string") return json({ error: "no endpoint" }, 400, request);

      await env.SUBS.delete(await keyFor(body.endpoint));
      return empty(204, request);
    }

    // --- 一覧。送信する側（GitHub Actions）だけが読む。
    if (url.pathname === "/subscriptions" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, request);

      const out = [];
      let cursor;
      do {
        const page = await env.SUBS.list({ cursor });
        for (const k of page.keys) {
          const v = await env.SUBS.get(k.name, "json");
          if (v) out.push({ key: k.name, ...v });
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);

      return json({ subscriptions: out }, 200, request);
    }

    // --- 無効になった購読の削除。
    //     プッシュサービスが 404 / 410 を返した購読を送信側から知らせてもらう。
    //     放っておくと、届かない相手に毎回送り続けることになる。
    if (url.pathname === "/prune" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, request);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400, request);
      }
      const keys = Array.isArray(body?.keys) ? body.keys.slice(0, 500) : [];
      await Promise.all(keys.map((k) => env.SUBS.delete(k)));
      return json({ deleted: keys.length }, 200, request);
    }

    return json({ error: "not found" }, 404, request);
  },
};
