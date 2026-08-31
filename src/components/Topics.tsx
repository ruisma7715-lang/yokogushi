import type { Topics as TopicsData } from "../types";

// 米指標の発表日は現地日付で届く。日本で読むと発表は「その日の夜」になるので、
// 今日のぶんだけ「今夜」と書き分ける。
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

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

  // 両方とも空のときは、枠だけ残しても意味がないので何も出さない
  if (upcoming.length === 0 && headlines.length === 0) return null;

  return (
    <section className="topics-section">
      <div className="topics-head">
        <h2 className="section-title">今日のトピックス</h2>
        <span className="topics-src">公式発表のみ</span>
      </div>

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
          <h3 className="topics-sub">中央銀行の公表</h3>
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
