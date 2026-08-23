import { useEffect, useState } from "react";

const KEY = "yokogushi-start-dismissed";

// 情報量が多いページなので、初見の人が迷子にならないよう最初に道順を出す。
// 一度閉じたら覚えておき、二度目からは邪魔をしない。
export default function StartHere() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 記憶できなくても閉じられれば十分 */
    }
  };

  if (!show) return null;

  return (
    <aside className="start-here">
      <div className="start-head">
        <h2>はじめての方へ</h2>
        <button type="button" onClick={close} aria-label="この案内を閉じる">
          ×
        </button>
      </div>

      <p className="start-lead">
        このサイトは、<strong>株・金・ビットコインなどをまとめて見て、
        自分の資産がどのくらい増減しうるかを知る</strong>ためのものです。
        上から順に見る必要はありません。
      </p>

      <ol className="start-steps">
        <li>
          <span className="start-num">1</span>
          <div>
            <strong>今日わかったこと</strong>を読む
            <span>その日の値動きで、いつもと違ったことだけを自動でまとめています。</span>
          </div>
        </li>
        <li>
          <span className="start-num">2</span>
          <div>
            <strong>わたしのポートフォリオ</strong>に持っているものを入れる
            <span>
              金額を入れると「1年でいくら増減しうるか」が円で出ます。
              入力はこのブラウザの中だけに保存され、どこにも送信されません。
            </span>
          </div>
        </li>
        <li>
          <span className="start-num">3</span>
          <div>
            <strong>どれとどれが一緒に動く？</strong>を見る
            <span>
              似た動きのものばかり持っていると、数を分けてもリスクは分散できていません。
            </span>
          </div>
        </li>
      </ol>

      <p className="start-note">
        投資の勧誘や助言をするサイトではありません。判断の材料を並べるだけの場所です。
      </p>
    </aside>
  );
}
