import { useEffect, useState } from "react";
import { PUSH, pushReady } from "../pushConfig";

// 相場の更新を通知で受け取るための購読ボタン。
//
// 出す条件が多いので、状態を先に決めてから描く。
//   unsupported   … Service Worker か Push API が無い（古いブラウザ）
//   needs-install … iOS。ホーム画面に追加した web app でないと Push API が存在しない
//   denied        … 通知を拒否済み。ここから元に戻すにはブラウザの設定が要る
//   subscribed    … 購読中
//   idle          … 購読できる
type State = "loading" | "unsupported" | "needs-install" | "denied" | "subscribed" | "idle";

// applicationServerKey は base64url ではなく生のバイト列で渡す必要がある。
function urlBase64ToUint8Array(base64: string) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS は Mac を名乗るため、タッチの有無で見分ける
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

export default function PushSubscribe() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!("serviceWorker" in navigator)) return alive && setState("unsupported");

      // iOS はホーム画面に追加した web app でしか PushManager が存在しない。
      // 「使えません」で終わらせず、どうすれば使えるかを出す。
      if (!("PushManager" in window)) {
        return alive && setState(isIOS() && !isStandalone() ? "needs-install" : "unsupported");
      }

      if (Notification.permission === "denied") return alive && setState("denied");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (alive) setState(sub ? "subscribed" : "idle");
    })().catch(() => alive && setState("unsupported"));

    return () => {
      alive = false;
    };
  }, []);

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      // 許可を求めるのは必ずボタンを押した直後。勝手に出すと拒否されて二度と出せない。
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUSH.vapidPublicKey),
      });

      const res = await fetch(`${PUSH.workerUrl}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(`登録できませんでした（${res.status}）`);

      setState("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // 先に受け口から消す。ブラウザ側だけ消えて登録が残ると、届かない相手に送り続ける。
        await fetch(`${PUSH.workerUrl}/unsubscribe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除できませんでした");
    } finally {
      setBusy(false);
    }
  }

  // 受け口が無いあいだは何も出さない。押しても何も起きないボタンは置かない。
  if (!pushReady() || state === "loading" || state === "unsupported") return null;

  return (
    <section className="push">
      <h2 className="section-title">更新を受け取る</h2>

      {state === "needs-install" && (
        <p className="push-note">
          iPhone・iPad で通知を受け取るには、先にこのページをホーム画面に追加してください。
          共有ボタン から「ホーム画面に追加」を選び、追加されたアイコンから開くと、ここに購読ボタンが出ます。
        </p>
      )}

      {state === "denied" && (
        <p className="push-note">
          このサイトの通知は拒否されています。受け取るには、ブラウザのサイト設定で通知を許可してください。
        </p>
      )}

      {state === "idle" && (
        <>
          <p className="push-note">
            平日の朝と夕方に、その日の相場を1通お送りします。サイトを開かなくても通知センターに表示されます。
          </p>
          <button className="push-btn" onClick={subscribe} disabled={busy}>
            {busy ? "登録しています…" : "通知を受け取る"}
          </button>
        </>
      )}

      {state === "subscribed" && (
        <>
          <p className="push-note">通知を受け取る設定になっています。</p>
          <button className="push-btn ghost" onClick={unsubscribe} disabled={busy}>
            {busy ? "解除しています…" : "通知を止める"}
          </button>
        </>
      )}

      {error && <p className="push-error">{error}</p>}

      <p className="push-fine">
        受け取るのは相場の更新だけです。宣伝は送りません。いつでも解除できます。
        メールアドレスなどは一切お預かりしません。
      </p>
    </section>
  );
}
