// ヨコグシ — Web Push の VAPID 鍵を作る
//
// VAPID は「この通知はヨコグシが送った」を証明するための鍵。
// 公開鍵はブラウザに渡す（購読時にこの鍵で縛るので、秘密鍵を持たない第三者は
// 同じ購読者に通知を送れない）。秘密鍵は Actions の Secrets にだけ置く。
//
//   node scripts/vapid.mjs
//
// 一度作ったら作り直さない。鍵を変えると、既存の購読が全部無効になる。

import { generateKeyPairSync } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// encoding を渡さないと KeyObject がそのまま返る。JWK に出せば生の座標が取れる。
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// Web Push が求めるのは DER でも PEM でもなく、生の鍵そのもの。
// 公開鍵は非圧縮形式の65バイト（0x04 + X32 + Y32）、秘密鍵は32バイト。
const jwk = publicKey.export({ format: "jwk" });
const pub = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]);
const priv = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");

console.log("VAPID 鍵を作りました。一度きりです（作り直すと既存の購読が無効になります）\n");
console.log("  公開鍵  … src/pushConfig.ts の vapidPublicKey に貼る（公開してよい）");
console.log(`  ${b64url(pub)}\n`);
console.log("  秘密鍵  … GitHub Secrets の VAPID_PRIVATE_KEY に入れる（絶対に公開しない）");
console.log(`  ${b64url(priv)}\n`);
console.log(`  長さの確認: 公開鍵 ${pub.length} バイト / 秘密鍵 ${priv.length} バイト`);
