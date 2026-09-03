import { useState } from "react";
import type { AssetSnapshot, Conditional as ConditionalData } from "../types";

// こういう日は、どうなるか。
//
// 相関マトリクスは「全部の日を平均するとこう」で、
// 「株が売られた日に金はどうだったか」には答えられない。ここがその答え。
//
// 表示上の決めごと:
//   ・棒の長さは z（その資産の普段の値動きの何倍か）。米10年債だけ単位が %pt なので、
//     生の値を同じ目盛りに並べると比べられないものを比べたことになる。
//   ・数値は各資産の単位のまま出す。棒は「普段と比べてどうか」、数値は「いくら動いたか」。
//   ・全期間の平均を横に置く。条件付きの数字は、それと比べて初めて意味が出る。
//   ・該当日数が足りない条件は、数字そのものを出さない。

const BAR_MAX = 1.2; // これを超えるσは棒を振り切らせる（外れ値で他が潰れるのを防ぐ）

function fmt(v: number, unit: string) {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${Math.abs(v).toFixed(2)}${unit}`;
}

export default function Conditional({
  data,
  assets,
}: {
  data: ConditionalData;
  assets: AssetSnapshot[];
}) {
  const [active, setActive] = useState(data.conditions[0]?.id ?? "");
  const current = data.conditions.find((c) => c.id === active) ?? data.conditions[0];
  if (!current) return null;

  return (
    <section className="cond">
      <div className="cond-head">
        <h2 className="section-title">こういう日は、どうなるか</h2>
        <span className="cond-window">
          {data.window.from} 〜 {data.window.to}（{data.window.days}営業日）
        </span>
      </div>

      <p className="cond-lead">
        相関は全部の日をならした数字です。ここでは条件を切って、
        <strong>その条件に当てはまる日だけ</strong>の平均を出しています。
      </p>

      {/* 条件の切り替え。1行に収めて、選択中がどれかを色ではなく枠でも示す */}
      <div className="cond-tabs" role="tablist">
        {data.conditions.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === current.id}
            className={`cond-tab ${c.id === current.id ? "on" : ""}`}
            onClick={() => setActive(c.id)}
          >
            {c.label}
            <span className="cond-tab-n">{c.n}日</span>
          </button>
        ))}
      </div>

      <p className="cond-detail">{current.detail}</p>

      {!current.enough ? (
        <p className="cond-thin">
          該当したのは {current.n} 日だけです。{data.minDays} 日に満たない条件から傾向は読めないので、
          数字は出していません。日が貯まれば自動で出ます。
        </p>
      ) : (
        <>
          {current.note && <p className="cond-note">{current.note}</p>}

          <ul className="cond-list">
            {assets.map((a) => {
              const s = current.assets[a.id];
              if (!s) return null;
              const base = data.baseline[a.id];

              const ratio = Math.min(Math.abs(s.z) / BAR_MAX, 1) * 50;
              const dir = s.mean > 0 ? "up" : s.mean < 0 ? "down" : "flat";
              const mark = s.mean > 0 ? "▲" : s.mean < 0 ? "▼" : "―";

              return (
                <li key={a.id} className="cond-row">
                  <span className="cond-name">{a.name}</span>

                  {/* 中央が0。右が上昇＝赤、左が下落＝青（日本の慣習） */}
                  <span
                    className="cond-track"
                    title={`${a.name}: 平均 ${fmt(s.mean, s.unit)}／普段の値動きの ${Math.abs(s.z).toFixed(2)} 倍`}
                  >
                    <span className="cond-zero" />
                    <span
                      className={`cond-bar ${dir}`}
                      style={
                        s.mean >= 0
                          ? { left: "50%", width: `${ratio}%` }
                          : { right: "50%", width: `${ratio}%` }
                      }
                    />
                  </span>

                  <span className={`cond-val ${dir}`}>
                    {mark} {fmt(s.mean, s.unit).replace(/^[+−±]/, "")}
                  </span>

                  <span className="cond-rate">
                    上昇 {s.upRate}%
                  </span>

                  <span className="cond-base">
                    普段 {fmt(base.mean, s.unit)} / {base.upRate}%
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="cond-fine">
            棒の長さは、その資産の普段の1日の値動きと比べた大きさです。
            米10年債利回りだけ単位が %ポイントなので、数値をそのまま他と比べることはできません。
            「上昇」はその条件の日のうち、上がった日の割合です。
          </p>
        </>
      )}
    </section>
  );
}
