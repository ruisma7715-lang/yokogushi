import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages は https://<ユーザー名>.github.io/<リポジトリ名>/ で配信されるため、
// リポジトリ名をベースに指定する必要がある。
// 独自ドメインや Cloudflare Pages（ルート配信）に移すときは "/" に戻すこと。
export default defineConfig({
  plugins: [react()],
  base: "/yokogushi/",
});
