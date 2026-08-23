import type { AssetSnapshot } from "../types";

// 資産ごとの識別色。styles.css のトークン名と対応。
const DOT: Record<string, string> = {
  nikkei: "var(--a-nikkei)",
  sp500: "var(--a-sp500)",
  usdjpy: "var(--a-usdjpy)",
  gold: "var(--a-gold)",
  btc: "var(--a-btc)",
  us10y: "var(--a-us10y)",
};

// 小数の桁数は資産によって変える。利回りは3桁ないと動きが見えない。
function formatValue(value: number, unit: string) {
  const digits = unit === "%" ? 3 : value >= 1000 ? 0 : 2;
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// 色だけに意味を持たせないよう、▲▼ の記号を必ず添える。
function Delta({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="delta">
        <dt>{label}</dt>
        <dd className="flat">—</dd>
      </div>
    );
  }

  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const mark = value > 0 ? "▲" : value < 0 ? "▼" : "―";

  return (
    <div className="delta">
      <dt>{label}</dt>
      <dd className={dir}>
        {mark} {Math.abs(value).toFixed(2)}%
      </dd>
    </div>
  );
}

export default function AssetCard({ asset }: { asset: AssetSnapshot }) {
  return (
    <article className="card">
      <div className="card-head">
        <span className="card-dot" style={{ background: DOT[asset.id] ?? "var(--ink-3)" }} />
        <h2 className="card-name">{asset.name}</h2>
        <span className="card-cls">{asset.cls}</span>
      </div>

      <p className="card-value">
        {formatValue(asset.value, asset.unit)}
        <small>{asset.unit}</small>
      </p>

      <dl className="deltas">
        <Delta label="前日" value={asset.changeDay} />
        <Delta label="1週" value={asset.changeWeek} />
        <Delta label="1ヶ月" value={asset.changeMonth} />
      </dl>
    </article>
  );
}
