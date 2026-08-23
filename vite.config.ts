import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 相対パスで出力しておくと、どのホスティング先でもそのまま動く
  base: "./",
});
