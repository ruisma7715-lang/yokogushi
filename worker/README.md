# 購読情報の受け口

訪問者に Web Push を送るために、購読情報（endpoint と鍵）を預かる場所。
ここが無いと Web Push は成立しない。静的サイトには、ブラウザが作った購読情報を
POST する先が無いため。

**本体とは独立している。** ここが止まっても相場データの取得・表示・自分あての ntfy 通知は動く。

## なぜ Cloudflare Workers か

- 無料枠（1日10万リクエスト）で足りる。購読者が数千人規模になるまで課金されない
- KV が付いてくるので、購読情報の保存に別のDBが要らない
- クレジットカードの登録なしでアカウントを作れる

## セットアップ

一度だけ。`yokogushi/worker/` の中で実行する。

```bash
cd worker

# 1. Cloudflare にログイン（ブラウザが開く）
#    アカウントが無ければ https://dash.cloudflare.com/sign-up で先に作る
npx wrangler login

# 2. 購読情報の保存先を作る
npx wrangler kv namespace create SUBS
#    → 出力された id を wrangler.toml の kv_namespaces.id に貼る

# 3. 一覧と削除に使うトークンを入れる
#    値は GitHub Secrets の PUSH_ADMIN_TOKEN と同じものにすること
npx wrangler secret put ADMIN_TOKEN

# 4. 公開する
npx wrangler deploy
#    → https://yokogushi-push.<アカウント名>.workers.dev が出る
```

デプロイして出た URL を2箇所に入れる。**両方やらないと動かない。**

```bash
# 画面の購読ボタンを出すため（ここが空のあいだ、購読UIは何も描かれない）
#   src/pushConfig.ts の workerUrl に貼る

# 送信側が購読者を読み出すため
gh secret set PUSH_WORKER_URL --body "https://yokogushi-push.<アカウント名>.workers.dev"
```

`src/pushConfig.ts` を直したらコミットして push する。サイトが再ビルドされ、購読ボタンが出る。

## 確認

```bash
# 受け口が生きているか（401 が返れば正常。トークン無しで一覧は見せない）
curl -i https://yokogushi-push.<アカウント名>.workers.dev/subscriptions

# 購読者の一覧（トークンあり）
curl -H "Authorization: Bearer <PUSH_ADMIN_TOKEN>" \
  https://yokogushi-push.<アカウント名>.workers.dev/subscriptions
```

サイトで購読ボタンを押したあと、上のコマンドで1件増えていれば繋がっている。

## 中身の確認

Cloudflare にデプロイしなくてもロジックは確かめられる。

```bash
node worker/test.mjs
```

KV を Map で置き換えて Worker の fetch を直接呼ぶ。誰でも POST できる口なので、
「弾くべきものを弾けているか」を中心に見ている。

## 経路

| 道 | 誰が使う | 認証 |
|---|---|---|
| `POST /subscribe` | 訪問者のブラウザ | なし（送り先ホストを検査） |
| `POST /unsubscribe` | 訪問者のブラウザ | なし（自分の endpoint のみ） |
| `GET /subscriptions` | GitHub Actions | `ADMIN_TOKEN` |
| `POST /prune` | GitHub Actions | `ADMIN_TOKEN` |

`/subscribe` は誰でも叩けるので、endpoint のホストを各ブラウザのプッシュサービスに限っている。
でたらめな値で KV が埋まるのを防ぐため。CORS もサイトのオリジンだけに絞っている。
