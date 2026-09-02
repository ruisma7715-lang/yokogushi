// Web Push の設定。どちらも公開してよい値。
//
// workerUrl が空のあいだは購読ボタンを出さない。受け口が無い状態でボタンだけ
// 見せると、押しても何も起きないものを置くことになる。
// Cloudflare に worker/ をデプロイしたら、その URL をここに入れる。
//
// 秘密鍵はここには絶対に置かない。GitHub Secrets の VAPID_PRIVATE_KEY にだけ置く。

export const PUSH = {
  /** 例: "https://yokogushi-push.<アカウント名>.workers.dev" 。空なら購読UIを出さない */
  workerUrl: "",

  /** VAPID の公開鍵。購読時にこの鍵で縛るので、秘密鍵を持たない第三者は同じ相手に送れない */
  vapidPublicKey: "BITE29N-Oy_g-p3CHkTBgmiwz9D3YO9E8mw0f-hahUDgUruN3h4CEbF-IeKT4DsLknIlo-EHRqrm1I4ztwXZ-Vs",
};

export const pushReady = () => PUSH.workerUrl !== "" && PUSH.vapidPublicKey !== "";
