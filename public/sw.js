// ヨコグシ — Service Worker
//
// 目的は2つだけ。
//   1. ホーム画面に追加したときにアプリとして起動できるようにする
//   2. 再訪を速くし、電波が無くても「最後に見た相場」が残るようにする
//
// キャッシュの取り違えは訪問者のブラウザに壊れた状態を残すので、方針を狭く固定する。
//
//   ページ遷移        … ネット優先。落ちたらキャッシュの index.html
//   data/*.json      … ネット優先。落ちたら最後に取れたもの（古い値を出すが、何も出ないよりよい）
//   assets/*         … キャッシュ優先。ファイル名にハッシュが入るので中身は変わらない
//   それ以外・外部    … 素通し。フォントなどをここで抱え込まない
//
// 古い値を見せる可能性があるのは data だけ。画面には各データの asOf が出るので、
// 利用者は「いつ時点の値か」を必ず確認できる。

const VERSION = "yokogushi-v2";
const BASE = "/yokogushi/";
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icon-192.png`];

self.addEventListener("install", (event) => {
  // 起動に必要な最小限だけ先に入れておく。失敗しても install は止めない
  // （1ファイル取れないだけで Service Worker ごと入らないのは割に合わない）。
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  // 前の版のキャッシュを残さない。残すと、古いアセットがいつまでも使われる。
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** ネット優先。取れたら保存し、落ちたらキャッシュを返す */
async function networkFirst(request, fallbackTo) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    // 部分応答やエラーを保存すると、次回それが返って壊れる
    if (res && res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(request)) ?? (fallbackTo && (await cache.match(fallbackTo)));
    if (hit) return hit;
    throw new Error("offline");
  }
}

/** キャッシュ優先。ハッシュ付きのファイルにだけ使う */
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res && res.ok && res.status === 200) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 触るのは自分のオリジンの GET だけ。外部フォントやAPIには一切関与しない。
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  // ページ遷移。古い index.html を返し続けると新しいアセットに繋がらなくなるため、
  // 必ずネットを先に見る。
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, `${BASE}index.html`));
    return;
  }

  // 相場データ。古い値を返すことはあるが、画面に asOf が出るので誤解は生まれない。
  if (url.pathname.startsWith(`${BASE}data/`)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // ビルド成果物。ファイル名にハッシュが入っているので、中身が変わることはない。
  if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // それ以外（アイコン・manifest・feed など）はネット優先で十分。
  event.respondWith(networkFirst(request));
});

// ---------------------------------------------------------------- 通知
//
// 購読した人に相場を届ける。中身は送信側（scripts/push.mjs）が作った JSON。
// ここでは受け取って出すだけにして、文面の組み立てを2箇所に持たない。

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // JSON でない通知が来ても黙って捨てない。本文として出す。
    data = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "ヨコグシ", {
      body: data.body || "",
      icon: `${BASE}icon-192.png`,
      badge: `${BASE}icon-192.png`,
      lang: "ja",
      // 同じタグにして、古い通知を置き換える。毎日2件ずつ溜まると読まれなくなる。
      tag: "yokogushi-daily",
      renotify: true,
      data: { url: data.url || BASE },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || BASE;

  // すでに開いているタブがあればそれを前に出す。毎回新しいタブが増えるのを防ぐ。
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(BASE) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
