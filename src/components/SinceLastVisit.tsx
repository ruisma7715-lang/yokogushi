import { useEffect, useState } from "react";
import type { AssetSnapshot, Latest } from "../types";

// 前回このページを開いたときの値を、ブラウザの中だけに覚えておく。
// 「留守にしている間に何が動いたか」が分かると、次にまた開く理由になる。
// 保存するのは日付と6つの数字だけ。サーバーには送らない。
const KEY = "yokogushi-last-visit";

type Visit = { asOf: string; at: number; values: Record<string, number> };
type Diff = { id: string; name: string; unit: string; diff: number; pct: boolean };

function read(): Visit | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Visit;
    return v && typeof v.asOf === "string" && v.values ? v : null;
  } catch {
    return null; // 読めなければ「初回」として扱えばいい
  }
}

function save(latest: Latest) {
  try {
    const values: Record<string, number> = {};
    for (const a of latest.assets) values[a.id] = a.value;
    localStorage.setItem(KEY, JSON.stringify({ asOf: latest.asOf, at: Date.now(), values }));
  } catch {
    /* 保存できなくても表示は成立する */
  }
}

// 利回りは「%が何%動いたか」では意味が通らないので、pt（ポイント）の差で見せる。
function diffOf(asset: AssetSnapshot, before: number): Diff | null {
  if (!Number.isFinite(before) || before === 0) return null;
  const pct = asset.unit !== "%";
  const diff = pct ? (asset.value / before - 1) * 100 : asset.value - before;
  return { id: asset.id, name: asset.name, unit: asset.unit, diff, pct };
}

function elapsed(from: number) {
  const days = Math.floor((Date.now() - from) / 864e5);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return `${days}日前`;
}

export default function SinceLastVisit({ latest }: { latest: Latest }) {
  const [state, setState] = useState<{ when: string; asOf: string; diffs: Diff[] } | null>(null);

  useEffect(() => {
    const last = read();
    save(latest); // 読んだ直後に上書きする。次回の基準は「今」になる

    if (!last || last.asOf === latest.asOf) return; // 初回、または前回から更新なし

    const diffs = latest.assets
      .map((a) => diffOf(a, last.values[a.id]))
      .filter((d): d is Diff => d !== null && Math.abs(d.diff) >= 0.01)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 3);

    if (diffs.length === 0) return;

    setState({ when: elapsed(last.at), asOf: last.asOf, diffs });
  }, [latest]);

  if (!state) return null;

  return (
    <aside className="since">
      <span className="since-when">
        前回ひらいたのは{state.when}（{state.asOf} 時点）
      </span>
      <span className="since-sep">それから</span>
      <ul className="since-list">
        {state.diffs.map((d) => {
          const up = d.diff > 0;
          return (
            <li key={d.id} className={up ? "up" : "down"}>
              <span className="since-name">{d.name}</span>
              <span className="since-num">
                {up ? "▲" : "▼"} {up ? "+" : "−"}
                {Math.abs(d.diff).toFixed(2)}
                {d.pct ? "%" : "pt"}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
