// ヨコグシ — 購読の受け口の動作確認
//
//   node worker/test.mjs
//
// Cloudflare にデプロイしなくても中身は確かめられる。KV は Map で置き換え、
// Worker の fetch を直接呼ぶ。誰でも POST できる口なので、
// 「弾くべきものを弾けているか」を特に見る。

import worker from "./src/index.js";

const SITE = "https://ruisma7715-lang.github.io";
const TOKEN = "test-token";

// KV の代わり。put / get / delete / list だけ使っている。
function fakeKV() {
  const m = new Map();
  return {
    _m: m,
    async put(k, v) {
      m.set(k, v);
    },
    async get(k, type) {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async delete(k) {
      m.delete(k);
    },
    async list() {
      return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
}

const env = () => ({ SUBS: fakeKV(), ADMIN_TOKEN: TOKEN });

const post = (path, body, headers = {}) =>
  new Request(`https://push.example${path}`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (path, headers = {}) =>
  new Request(`https://push.example${path}`, { method: "GET", headers: { origin: SITE, ...headers } });

const GOOD = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BN" + "x".repeat(80), auth: "y".repeat(22) },
};

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  OK   ${name}`);
    pass++;
  } catch (err) {
    console.log(`  NG   ${name}\n         ${err.message}`);
    fail++;
  }
}

const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: ${got} であるべきところ ${want} を期待`);
};

console.log("購読の受け口\n");

await check("正しい購読を登録できる", async () => {
  const e = env();
  const res = await worker.fetch(post("/subscribe", GOOD), e);
  eq(res.status, 204, "status");
  eq(e.SUBS._m.size, 1, "保存件数");
});

await check("同じ購読を2回送っても増えない", async () => {
  const e = env();
  await worker.fetch(post("/subscribe", GOOD), e);
  await worker.fetch(post("/subscribe", GOOD), e);
  eq(e.SUBS._m.size, 1, "保存件数");
});

await check("知らないホストの endpoint は弾く", async () => {
  const e = env();
  const bad = { ...GOOD, endpoint: "https://evil.example/push/1" };
  const res = await worker.fetch(post("/subscribe", bad), e);
  eq(res.status, 400, "status");
  eq(e.SUBS._m.size, 0, "保存件数");
});

await check("http の endpoint は弾く", async () => {
  const e = env();
  const bad = { ...GOOD, endpoint: "http://fcm.googleapis.com/fcm/send/abc" };
  eq((await worker.fetch(post("/subscribe", bad), e)).status, 400, "status");
});

await check("鍵が欠けていたら弾く", async () => {
  const e = env();
  const bad = { endpoint: GOOD.endpoint };
  eq((await worker.fetch(post("/subscribe", bad), e)).status, 400, "status");
});

await check("壊れたJSONで落ちない", async () => {
  const e = env();
  eq((await worker.fetch(post("/subscribe", "{壊れ"), e)).status, 400, "status");
});

await check("長すぎる endpoint は弾く", async () => {
  const e = env();
  const bad = { ...GOOD, endpoint: "https://fcm.googleapis.com/" + "a".repeat(1200) };
  eq((await worker.fetch(post("/subscribe", bad), e)).status, 400, "status");
});

await check("解除できる", async () => {
  const e = env();
  await worker.fetch(post("/subscribe", GOOD), e);
  const res = await worker.fetch(post("/unsubscribe", { endpoint: GOOD.endpoint }), e);
  eq(res.status, 204, "status");
  eq(e.SUBS._m.size, 0, "保存件数");
});

await check("一覧はトークンが無いと見られない", async () => {
  const e = env();
  await worker.fetch(post("/subscribe", GOOD), e);
  eq((await worker.fetch(get("/subscriptions"), e)).status, 401, "status");
});

await check("一覧は間違ったトークンでは見られない", async () => {
  const e = env();
  // HTTPヘッダに日本語は入らないので、間違ったトークンも英数字で書く
  const res = await worker.fetch(get("/subscriptions", { authorization: "Bearer wrong-token" }), e);
  eq(res.status, 401, "status");
});

await check("正しいトークンなら一覧が取れる", async () => {
  const e = env();
  await worker.fetch(post("/subscribe", GOOD), e);
  const res = await worker.fetch(get("/subscriptions", { authorization: `Bearer ${TOKEN}` }), e);
  eq(res.status, 200, "status");
  const body = await res.json();
  eq(body.subscriptions.length, 1, "件数");
  eq(body.subscriptions[0].endpoint, GOOD.endpoint, "endpoint");
  if (!body.subscriptions[0].key) throw new Error("削除に使う key が入っていない");
});

await check("prune で消せる", async () => {
  const e = env();
  await worker.fetch(post("/subscribe", GOOD), e);
  const key = [...e.SUBS._m.keys()][0];
  const res = await worker.fetch(
    post("/prune", { keys: [key] }, { authorization: `Bearer ${TOKEN}` }),
    e
  );
  eq(res.status, 200, "status");
  eq(e.SUBS._m.size, 0, "保存件数");
});

await check("prune はトークンが要る", async () => {
  const e = env();
  eq((await worker.fetch(post("/prune", { keys: [] }), e)).status, 401, "status");
});

await check("よそのオリジンには CORS を許可しない", async () => {
  const e = env();
  const req = new Request("https://push.example/subscribe", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify(GOOD),
  });
  const res = await worker.fetch(req, e);
  eq(res.headers.get("access-control-allow-origin"), "", "allow-origin");
});

await check("自分のサイトには CORS を許可する", async () => {
  const e = env();
  const res = await worker.fetch(post("/subscribe", GOOD), e);
  eq(res.headers.get("access-control-allow-origin"), SITE, "allow-origin");
});

await check("プリフライトに答える", async () => {
  const e = env();
  const req = new Request("https://push.example/subscribe", {
    method: "OPTIONS",
    headers: { origin: SITE },
  });
  eq((await worker.fetch(req, e)).status, 204, "status");
});

await check("知らない道は404", async () => {
  const e = env();
  eq((await worker.fetch(get("/どこか"), e)).status, 404, "status");
});

console.log(`\n  ${pass} 件通過 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
