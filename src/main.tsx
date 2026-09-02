import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ホーム画面に追加できるようにし、再訪を速くする。
// 開発中は登録しない。dev サーバーのアセットを抱え込むと、直したはずの
// 変更が反映されずに原因を探す羽目になる。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // 失敗しても画面は普通に動く。ここで落として本体を巻き添えにしない。
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined);
  });
}
