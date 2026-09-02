import type { MarketIndex, MarketInternals, Topics as TopicsData } from "../types";

// 米指標の発表日は現地日付で届く。日本で読むと発表は「その日の夜」になるので、
// 今日のぶんだけ「今夜」と書き分ける。
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

// 騰落は日本の慣習で 上昇=赤 / 下落=青。色だけに意味を持たせず ▲▼ を必ず添える。
function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="mkt-pct flat">—</span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const mark = value > 0 ? "▲" : value < 0 ? "▼" : "―";
  return (
    <span className={`mkt-pct ${dir}`}>
      {mark} {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function IndexRow({ x }: { x: MarketIndex }) {
  return (
    <li className="mkt-row">
      <span className="mkt-name">
        {x.name}
        {x.note && <em className="mkt-note">{x.note}</em>}
      </span>
      <span className="mkt-val">{x.value.toLocaleString("ja-JP")}</span>
      <Pct value={x.changeDay} />
    </li>
  );
}

// 今日の市場。カードの6資産が「横断」なのに対し、ここは市場の内訳を見るところ。
// 日付は資産ごとの最新日でも共通日でもなく「指数どうしが揃った日」なので、
// 混同しないよう見出しの横に必ず出す。
function Market({ m }: { m: MarketInternals }) {
  if (!m.us && !m.jp) return null;

  return (
    <div className="mkt">
      <h3 className="topics-sub">今日の市場</h3>

      {m.us && (
        <div className="mkt-block">
          <div className="mkt-when">
            米国 <span className="mkt-date">{shortDay(m.us.asOf)}</span>
          </div>
          <ul className="mkt-list">
            {m.us.indices.map((x) => (
              <IndexRow key={x.id} x={x} />
            ))}
            {m.us.vix && (
              <li className="mkt-row">
                <span className="mkt-name">
                  VIX
                  <em className="mkt-note">
                    先行きの振れ幅
                    {/* 指数と揃わない日だけ日付を出す。揃った日にも出すと、どれが古いか分からなくなる */}
                    {m.us.vix.asOf !== m.us.asOf && ` · ${shortDay(m.us.vix.asOf)}時点`}
                  </em>
                </span>
                <span className="mkt-val">{m.us.vix.value.toFixed(2)}</span>
                <span className="mkt-pct flat">
                  {m.us.vix.avg60 !== null ? `60日平均 ${m.us.vix.avg60.toFixed(2)}` : "—"}
                </span>
              </li>
            )}
          </ul>
          {m.us.lines.map((t) => (
            <p key={t} className="mkt-line">
              {t}
            </p>
          ))}
        </div>
      )}

      {m.jp && (
        <div className="mkt-block">
          <div className="mkt-when">
            日本 <span className="mkt-date">{shortDay(m.jp.asOf)}</span>
          </div>
          <ul className="mkt-list">
            {m.jp.indices.map((x) => (
              <IndexRow key={x.id} x={x} />
            ))}
          </ul>
          {m.jp.lines.map((t) => (
            <p key={t} className="mkt-line">
              {t}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function dayLabel(iso: string, today: string) {
  const at = Date.parse(`${iso}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  const diff = Math.round((at - base) / 864e5);

  if (diff === 0) return "今夜";
  if (diff === 1) return "明日";

  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}（${WEEK[new Date(at).getUTCDay()]}）`;
}

export default function Topics({ data }: { data: TopicsData }) {
  // 毎週出る指標（失業保険申請など）で枠が埋まらないよう、同じ指標は直近の1回だけ出す
  const seen = new Set<string>();
  const upcoming = data.calendar
    .filter((c) => c.date >= data.today)
    .filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    })
    .slice(0, 4);

  const { headlines } = data;
  const market = data.market ?? null;
  const hasMarket = !!market && (!!market.us || !!market.jp);

  // どれも空のときは、枠だけ残しても意味がないので何も出さない
  if (upcoming.length === 0 && headlines.length === 0 && !hasMarket) return null;

  return (
    <section className="topics-section">
      <div className="topics-head">
        <h2 className="section-title">今日のトピックス</h2>
        <span className="topics-src">一次データと公式発表のみ</span>
      </div>

      {hasMarket && <Market m={market} />}

      {upcoming.length > 0 && (
        <div className="cal">
          <h3 className="topics-sub">これから出る数字</h3>
          <ul className="cal-list">
            {upcoming.map((c) => {
              const label = dayLabel(c.date, data.today);
              const soon = label === "今夜" || label === "明日";
              return (
                <li key={`${c.date}-${c.name}`} className={`cal-row ${soon ? "soon" : ""}`}>
                  <span className="cal-when">{label}</span>
                  <span className="cal-name">{c.name}</span>
                  <span className="cal-why">{c.why}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {headlines.length > 0 && (
        <div className="news">
          {/* 中央銀行だけでなく官庁の統計も入るようになったので「公式発表」で括る */}
          <h3 className="topics-sub">公式発表</h3>
          <ul className="news-list">
            {headlines.map((h) => (
              <li key={h.url}>
                <a href={h.url} target="_blank" rel="noopener nofollow">
                  {h.title}
                </a>
                <span className="news-meta">
                  {h.tag && <span className="news-tag">{h.tag}</span>}
                  {h.source}
                  {h.date ? ` ${h.date}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="news-note">
            見出しと発表元へのリンクだけを載せています。中身は発表元のページでご確認ください。
          </p>
        </div>
      )}
    </section>
  );
}
