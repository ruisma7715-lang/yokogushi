import { useState } from "react";
import type { AssetSnapshot, Correlation, CorrelationWindow } from "../types";

// 見出し用の短縮名。マトリクスは横幅が命なので、フル名は使わない。
const SHORT: Record<string, string> = {
  nikkei: "日経",
  sp500: "S&P",
  usdjpy: "ドル円",
  gold: "金",
  btc: "BTC",
  us10y: "米10年",
};

const WINDOWS = [
  { key: "d30", label: "30日" },
  { key: "d90", label: "90日" },
  { key: "d365", label: "1年" },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

// 相関の強さを5段階に落とす。境界値はここだけで管理する。
function band(r: number): "pos2" | "pos1" | "neu" | "neg1" | "neg2" {
  if (r >= 0.6) return "pos2";
  if (r >= 0.25) return "pos1";
  if (r > -0.25) return "neu";
  if (r > -0.6) return "neg1";
  return "neg2";
}

// 数字が読めなくても意味が伝わるように、段階ごとの言い換えを持っておく。
const WORD: Record<ReturnType<typeof band>, string> = {
  pos2: "そっくり",
  pos1: "似てる",
  neu: "無関係",
  neg1: "やや逆",
  neg2: "正反対",
};

function describe(a: string, b: string, r: number) {
  const v = Math.abs(r).toFixed(2);
  switch (band(r)) {
    case "pos2":
      return `${a} と ${b} は強く同じ方向に動いています（+${v}）。片方が上がればもう片方も上がる傾向で、両方を持っていても分散にはなりにくい状態です。`;
    case "pos1":
      return `${a} と ${b} はゆるやかに同じ方向に動いています（+${v}）。連動はしていますが、常に一緒とまでは言えません。`;
    case "neu":
      return `${a} と ${b} の間に、はっきりした関係は見られません（${r >= 0 ? "+" : "−"}${v}）。値動きの理由が別々なので、分散投資の観点では組み合わせやすい状態です。`;
    case "neg1":
      return `${a} と ${b} はゆるやかに逆方向に動いています（−${v}）。片方が下がるともう片方が上がりやすい関係です。`;
    case "neg2":
      return `${a} と ${b} は強く逆方向に動いています（−${v}）。値動きを互いに打ち消し合うため、組み合わせると全体の振れ幅が小さくなります。`;
  }
}

export default function CorrelationMatrix({
  assets,
  correlation,
}: {
  assets: AssetSnapshot[];
  correlation: Correlation;
}) {
  const [win, setWin] = useState<WindowKey>("d90");
  const [picked, setPicked] = useState<{ a: string; b: string; r: number } | null>(null);
  // 初見の人には数字より言葉のほうが伝わるので、こちらを初期表示にしている
  const [mode, setMode] = useState<"word" | "number">("word");

  const matrix: CorrelationWindow = correlation.windows[win];
  const ids = assets.map((a) => a.id);
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  return (
    <section className="matrix-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">どれとどれが一緒に動く？</h2>
          <p className="section-sub">
            同じ動きをするものばかり持っていると、分けて持っている意味が薄くなります。
          </p>
        </div>

        <div className="seg-group">
          <div className="seg" role="group" aria-label="表示のしかた">
            <button
              type="button"
              className={mode === "word" ? "on" : ""}
              aria-pressed={mode === "word"}
              onClick={() => setMode("word")}
            >
              ことば
            </button>
            <button
              type="button"
              className={mode === "number" ? "on" : ""}
              aria-pressed={mode === "number"}
              onClick={() => setMode("number")}
            >
              数字
            </button>
          </div>

          <div className="seg" role="group" aria-label="集計期間">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                className={w.key === win ? "on" : ""}
                aria-pressed={w.key === win}
                onClick={() => {
                  setWin(w.key);
                  setPicked(null);
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col" className="corner">
                <span className="sr">資産</span>
              </th>
              {ids.map((id) => (
                <th key={id} scope="col">
                  {SHORT[id] ?? id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((rowId) => (
              <tr key={rowId}>
                <th scope="row">{SHORT[rowId] ?? rowId}</th>
                {ids.map((colId) => {
                  const r = matrix?.[rowId]?.[colId] ?? null;

                  if (rowId === colId || r === null) {
                    return (
                      <td key={colId} className="cell self">
                        —
                      </td>
                    );
                  }

                  const isPicked =
                    picked !== null &&
                    ((picked.a === rowId && picked.b === colId) ||
                      (picked.a === colId && picked.b === rowId));

                  return (
                    <td key={colId} className="cell-td">
                      <button
                        type="button"
                        className={`cell ${band(r)}${isPicked ? " picked" : ""}${mode === "word" ? " word" : ""}`}
                        onClick={() => setPicked({ a: rowId, b: colId, r })}
                        aria-label={`${nameOf(rowId)} と ${nameOf(colId)} は ${WORD[band(r)]}（${r.toFixed(2)}）`}
                      >
                        {mode === "word"
                          ? WORD[band(r)]
                          : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="legend" aria-hidden="true">
        <span className="legend-cap">逆に動く</span>
        <span className="sw neg2">{mode === "word" ? "正反対" : "−1.0"}</span>
        <span className="sw neg1">{mode === "word" ? "やや逆" : "−0.5"}</span>
        <span className="sw neu">{mode === "word" ? "無関係" : "0"}</span>
        <span className="sw pos1">{mode === "word" ? "似てる" : "+0.5"}</span>
        <span className="sw pos2">{mode === "word" ? "そっくり" : "+1.0"}</span>
        <span className="legend-cap">一緒に動く</span>
      </div>

      <div className="readout" role="status">
        {picked ? (
          describe(nameOf(picked.a), nameOf(picked.b), picked.r)
        ) : (
          <span className="readout-idle">
            マスをタップすると、その2つの関係の説明が出ます。
          </span>
        )}
      </div>

      <details className="howto">
        <summary>相関のみかた</summary>
        <p>
          相関は、2つの資産が<strong>どれくらい一緒に動いたか</strong>を −1.00 〜 +1.00
          の数字で表したものです。日々の値動き（前日比）を突き合わせて計算しています。
        </p>
        <ul>
          <li>
            <strong>+1.00 に近い</strong>ほど、同じ方向に動いている。分散投資のつもりで
            両方持っていても、実は同じリスクを二重に取っていることになります。
          </li>
          <li>
            <strong>0 に近い</strong>ほど、無関係に動いている。組み合わせると全体の振れ幅が
            抑えられます。
          </li>
          <li>
            <strong>−1.00 に近い</strong>ほど、逆方向に動いている。片方の下落をもう片方が
            打ち消してくれる関係です。
          </li>
        </ul>
        <p>
          値そのものより、<strong>いつもと違う値になったとき</strong>が重要です。普段は逆に動く
          はずの組み合わせが一緒に動き出したら、相場の前提が変わったサインになります。
        </p>
      </details>
    </section>
  );
}
