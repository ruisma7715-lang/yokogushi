import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSnapshot, History } from "../types";

const COLOR: Record<string, string> = {
  nikkei: "var(--a-nikkei)",
  sp500: "var(--a-sp500)",
  usdjpy: "var(--a-usdjpy)",
  gold: "var(--a-gold)",
  btc: "var(--a-btc)",
  us10y: "var(--a-us10y)",
};

const RANGES = [
  { key: "m3", label: "3ヶ月", days: 63 },
  { key: "m6", label: "6ヶ月", days: 126 },
  { key: "all", label: "全期間", days: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const PAD = { top: 14, right: 14, bottom: 26, left: 46 };
const HEIGHT = 300;

export default function OverlayChart({
  assets,
  history,
}: {
  assets: AssetSnapshot[];
  history: History;
}) {
  const [range, setRange] = useState<RangeKey>("m6");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  // 幅は親要素に追従させる。SVGを引き伸ばすと文字が歪むので、実寸で描き直す。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = assets.filter((a) => !hidden.has(a.id));

  const view = useMemo(() => {
    const total = history.days.length;
    const span = RANGES.find((r) => r.key === range)!.days;
    const start = Math.max(0, total - (span === Infinity ? total : span));

    const days = history.days.slice(start);

    // 選んだ期間の初日を100として引き直す。
    // 「この期間でどれが一番伸びたか」を比較できるようにするのが狙い。
    const series: Record<string, number[]> = {};
    for (const a of assets) {
      const raw = history.series[a.id];
      if (!raw) continue;
      const base = raw[start];
      if (!base) continue;
      series[a.id] = raw.slice(start).map((v) => (v / base) * 100);
    }
    return { days, series };
  }, [history, range, assets]);

  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of visible) {
      for (const v of view.series[a.id] ?? []) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) return { min: 90, max: 110 };
    const pad = (hi - lo) * 0.08 || 5;
    return { min: lo - pad, max: hi + pad };
  }, [visible, view]);

  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const n = view.days.length;

  const xAt = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const ticks = useMemo(() => {
    const step = (max - min) / 4;
    return Array.from({ length: 5 }, (_, i) => min + step * i);
  }, [min, max]);

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD.left;
    const i = Math.round((x / plotW) * (n - 1));
    setCursor(Math.min(n - 1, Math.max(0, i)));
  }

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      // 全部消えると何も読めなくなるので、最後の1本は残す
      if (next.has(id)) next.delete(id);
      else if (visible.length > 1) next.add(id);
      return next;
    });

  return (
    <section className="chart-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">値動きの比較</h2>
          <p className="section-sub">
            期間の初日を 100 に揃えています。どれが一番伸びたかを直接比べられます。
          </p>
        </div>

        <div className="seg" role="group" aria-label="表示期間">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={r.key === range ? "on" : ""}
              aria-pressed={r.key === range}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-wrap" ref={wrapRef}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="各資産の値動きを指数化して重ねた折れ線グラフ"
          onPointerMove={handleMove}
          onPointerLeave={() => setCursor(null)}
        >
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAt(t)}
                y2={yAt(t)}
                className={Math.abs(t - 100) < (max - min) / 200 ? "gridline base" : "gridline"}
              />
              <text x={PAD.left - 8} y={yAt(t) + 4} className="axis" textAnchor="end">
                {t.toFixed(0)}
              </text>
            </g>
          ))}

          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
            <text key={i} x={xAt(i)} y={HEIGHT - 8} className="axis" textAnchor="middle">
              {view.days[i]?.slice(5).replace("-", "/")}
            </text>
          ))}

          {visible.map((a) => {
            const s = view.series[a.id];
            if (!s) return null;
            const d = s.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(v)}`).join("");
            return <path key={a.id} d={d} className="line" style={{ stroke: COLOR[a.id] }} />;
          })}

          {cursor !== null && (
            <>
              <line
                x1={xAt(cursor)}
                x2={xAt(cursor)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="crosshair"
              />
              {visible.map((a) => {
                const v = view.series[a.id]?.[cursor];
                if (v === undefined) return null;
                return (
                  <circle
                    key={a.id}
                    cx={xAt(cursor)}
                    cy={yAt(v)}
                    r={4}
                    className="dot"
                    style={{ fill: COLOR[a.id] }}
                  />
                );
              })}
            </>
          )}
        </svg>

        {cursor !== null && (
          <div
            className="tip"
            style={{
              left: Math.min(Math.max(xAt(cursor) + 12, 8), Math.max(8, width - 168)),
            }}
          >
            <p className="tip-date">{view.days[cursor]}</p>
            {visible.map((a) => (
              <p key={a.id} className="tip-row">
                <span className="tip-dot" style={{ background: COLOR[a.id] }} />
                <span className="tip-name">{a.name}</span>
                <span className="tip-val">{view.series[a.id]?.[cursor]?.toFixed(1)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="chart-legend">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`chip${hidden.has(a.id) ? " off" : ""}`}
            aria-pressed={!hidden.has(a.id)}
            onClick={() => toggle(a.id)}
          >
            <span className="chip-dot" style={{ background: COLOR[a.id] }} />
            {a.name}
          </button>
        ))}
      </div>
    </section>
  );
}
