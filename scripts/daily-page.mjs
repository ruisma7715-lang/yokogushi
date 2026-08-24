// 日次の解説ページを組み立てる。
//
// 目的は検索からの入口を毎日1つずつ増やすこと。
// そのため React ではなく、中身が最初からHTMLに入っている静的ページとして書き出す
// （JavaScriptで描画すると検索エンジンに拾われにくいため）。
//
// 文章は自動生成だが、断定や売買の推奨は避け、起きたことの説明だけに留める。

export const SITE_BASE = "https://ruisma7715-lang.github.io/yokogushi";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const jpDate = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
};

const signed = (v, digits = 2) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const STYLE = `
:root{color-scheme:light;--ground:#f6f8fa;--surface:#fff;--ink:#0f1720;--ink2:#4a5563;--ink3:#7c8798;--rule:#dde2e9;--accent:#1c5cab;--up:#c0392b;--down:#1c5cab}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--ground:#0e1116;--surface:#161b22;--ink:#e9edf2;--ink2:#a3aebd;--ink3:#78838f;--rule:#262d37;--accent:#5598e7;--up:#e8756a;--down:#5598e7}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans JP","Hiragino Sans","Yu Gothic",system-ui,sans-serif;line-height:1.9;font-feature-settings:"palt" 1;-webkit-font-smoothing:antialiased}
.wrap{max-width:44rem;margin:0 auto;padding:2rem 1.125rem 4rem}
.brand{font-family:"IBM Plex Mono",monospace;font-size:.8125rem;font-weight:700;letter-spacing:-.02em;color:var(--accent);text-decoration:none}
h1{font-size:1.75rem;line-height:1.4;margin:1.25rem 0 .5rem;text-wrap:balance}
.date{font-family:"IBM Plex Mono",monospace;font-size:.75rem;color:var(--ink3)}
.lead{font-size:1.0625rem;line-height:1.95;margin:1rem 0 2rem;padding:1rem 1.25rem;background:var(--surface);border-left:3px solid var(--accent);border-radius:4px}
h2{font-size:1.125rem;margin:2.25rem 0 .75rem;padding-top:1.25rem;border-top:1px solid var(--rule)}
p{margin:0 0 1rem;font-size:.9375rem}
table{width:100%;border-collapse:collapse;font-size:.875rem;margin:1rem 0 1.5rem;background:var(--surface);border:1px solid var(--rule);border-radius:6px;overflow:hidden}
th,td{padding:.625rem .75rem;text-align:left;border-bottom:1px solid var(--rule)}
tbody tr:last-child td{border-bottom:none}
th{font-family:"IBM Plex Mono",monospace;font-size:.6875rem;letter-spacing:.06em;color:var(--ink3);font-weight:500}
td.num{text-align:right;font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.up{color:var(--up)}.down{color:var(--down)}
ul{padding-left:1.25rem;font-size:.9375rem}
li{margin-bottom:.5rem}
.cta{display:block;margin:2.5rem 0 0;padding:1.25rem;background:var(--surface);border:1px solid var(--accent);border-radius:6px;text-decoration:none;color:inherit}
.cta strong{display:block;font-size:1rem;color:var(--accent);margin-bottom:.25rem}
.cta span{font-size:.8125rem;color:var(--ink2)}
.note{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--rule);font-size:.75rem;line-height:1.8;color:var(--ink3)}
.nav{display:flex;justify-content:space-between;gap:1rem;margin-top:1.5rem;font-size:.8125rem}
.nav a{color:var(--accent)}
.list{list-style:none;padding:0}
.list li{margin-bottom:.375rem}
.list a{color:var(--ink);text-decoration:none;display:flex;justify-content:space-between;gap:1rem;padding:.75rem 1rem;background:var(--surface);border:1px solid var(--rule);border-radius:4px}
.list a:hover{border-color:var(--accent)}
.list .d{font-family:"IBM Plex Mono",monospace;font-size:.75rem;color:var(--ink3);white-space:nowrap}
`;

function shell({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

/** その日1本ぶんの解説ページ */
export function renderDailyPage({ asOf, snapshot, highlights, prevDay, nextDay }) {
  const title = `${jpDate(asOf)}のマーケット｜日経平均・S&P500・金・ビットコインはどう動いたか`;

  const moved = [...snapshot]
    .filter((a) => typeof a.changeDay === "number")
    .sort((a, b) => Math.abs(b.changeDay) - Math.abs(a.changeDay));

  const top = moved[0];
  const regime = highlights.regime;

  const description =
    `${jpDate(asOf)}の値動きをまとめました。` +
    (top ? `最も大きく動いたのは${top.name}で${signed(top.changeDay)}%。` : "") +
    (regime ? `この日は「${regime.label}」の一日でした。` : "");

  const rows = snapshot
    .map((a) => {
      const c = a.changeDay;
      const cls = c == null ? "" : c > 0 ? "up" : c < 0 ? "down" : "";
      const mark = c == null ? "—" : c > 0 ? "▲" : c < 0 ? "▼" : "―";
      return `<tr>
<td>${esc(a.name)}</td>
<td class="num">${a.value.toLocaleString("ja-JP")}<span style="font-size:.75em;color:var(--ink3)"> ${esc(a.unit)}</span></td>
<td class="num ${cls}">${mark} ${c == null ? "—" : Math.abs(c).toFixed(2) + "%"}</td>
<td class="num ${a.changeMonth == null ? "" : a.changeMonth > 0 ? "up" : "down"}">${a.changeMonth == null ? "—" : signed(a.changeMonth) + "%"}</td>
</tr>`;
    })
    .join("\n");

  // 大きく動いたものから順に、事実だけを文章にする
  const paragraphs = moved.slice(0, 3).map((a) => {
    const dir = a.changeDay >= 0 ? "上昇" : "下落";
    return `<p><strong>${esc(a.name)}</strong>は前日比 ${signed(a.changeDay)}%${dir}し、${a.value.toLocaleString("ja-JP")}${esc(a.unit)}となりました。1ヶ月前と比べると ${a.changeMonth == null ? "—" : signed(a.changeMonth) + "%"} です。</p>`;
  });

  const items = highlights.items
    .filter((i) => i.kind !== "move")
    .map((i) => `<li>${esc(i.text)}</li>`)
    .join("\n");

  const nav = `<div class="nav">
${prevDay ? `<a href="./${prevDay}.html">← ${jpDate(prevDay)}</a>` : "<span></span>"}
${nextDay ? `<a href="./${nextDay}.html">${jpDate(nextDay)} →</a>` : "<span></span>"}
</div>`;

  const body = `
<a class="brand" href="../">ヨコグシ</a>
<p class="date">${asOf}</p>
<h1>${jpDate(asOf)}のマーケット</h1>

<p class="lead">${esc(
    regime
      ? `${regime.label}。${regime.detail}`
      : "この日の値動きをまとめました。"
  )}</p>

<h2>この日の値動き</h2>
<table>
<thead><tr><th>資産</th><th style="text-align:right">終値</th><th style="text-align:right">前日比</th><th style="text-align:right">1ヶ月</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>

<h2>何が起きたか</h2>
${paragraphs.join("\n")}

${items ? `<h2>いつもと違ったこと</h2>\n<ul>\n${items}\n</ul>` : ""}

<a class="cta" href="../">
<strong>自分の資産だと、いくら増減したのか</strong>
<span>持っている銘柄と金額を入れると、この日の値動きがあなたの資産にいくら効いたかを、原因ごとに分けて表示します。入力はブラウザの中だけに保存され、どこにも送信されません。</span>
</a>

${nav}

<p class="note">
このページは値動きのデータから自動で作成しています。出典は FRED（米セントルイス連銀）、Frankfurter（ECB）、CoinGecko。金は PAXG（金地金を裏付けとするトークン）の価格を用いた暫定値です。
本ページは情報提供を目的としたものであり、投資勧誘や投資助言ではありません。
</p>
`;

  return {
    html: shell({
      title,
      description,
      canonical: `${SITE_BASE}/daily/${asOf}.html`,
      body,
    }),
    title,
    description,
  };
}

/** 日次ページの一覧 */
export function renderIndex(days) {
  const body = `
<a class="brand" href="../">ヨコグシ</a>
<h1>マーケットの記録</h1>
<p>株・金・ビットコインの毎日の値動きと、その日に何が起きたかの記録です。平日の朝と夕方に自動で更新しています。</p>
<ul class="list">
${days
  .map(
    (d) =>
      `<li><a href="./${d}.html"><span>${jpDate(d)}のマーケット</span><span class="d">${d}</span></a></li>`
  )
  .join("\n")}
</ul>
<p class="note">本ページは情報提供を目的としたものであり、投資勧誘や投資助言ではありません。</p>
`;

  return shell({
    title: "マーケットの記録｜ヨコグシ",
    description: "株・金・ビットコインの毎日の値動きと、その日に何が起きたかの記録。",
    canonical: `${SITE_BASE}/daily/`,
    body,
  });
}

/** 検索エンジンに場所を伝えるための一覧 */
export function renderSitemap(days) {
  const urls = [
    `${SITE_BASE}/`,
    `${SITE_BASE}/daily/`,
    ...days.map((d) => `${SITE_BASE}/daily/${d}.html`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>`;
}
