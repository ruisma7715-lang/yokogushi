// ヨコグシ — 今日のトピックス（公式ソースのみ）
//
// 「今日なにがあったか / これから何があるか」を集める。
// 記事の転載やスクレイピングは一切しない。集めるのは次の2つだけ。
//
//   1. 公式RSSの見出しとリンク（本文は載せず、相手のサイトへ送客する）
//   2. FRED の公式リリースカレンダー（米指標の発表予定日）
//
// どのソースも落ちることがある。1つ失敗しても全体は止めない。

const TIMEOUT = 20000;

// ---------------------------------------------------------------- 小道具

async function getText(url, label) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      // 名乗らないと弾く配信元があるため、素性を明示する
      "user-agent": "yokogushi/0.1 (+https://ruisma7715-lang.github.io/yokogushi)",
      accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.text();
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

// 取り出したいタグは決め打ちなので、正規表現は組み立てずに並べておく。
// （文字列から組み立てるとエスケープを1つ落としただけで静かに空振りする）
const TAG_RE = {
  title: /<title[^>]*>([\s\S]*?)<\/title>/i,
  link: /<link[^>]*>([\s\S]*?)<\/link>/i,
  pubDate: /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
  "dc:date": /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i,
};

const pick = (block, name) => {
  const m = block.match(TAG_RE[name]);
  return m ? decode(m[1]) : "";
};

// RSS 2.0 / RDF のどちらでも <item> の中身は同じ形をしている。
// 依存を増やさないために、必要な3つだけを取り出す。
function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = pick(block, "title");
    const link = pick(block, "link");
    const date = pick(block, "pubDate") || pick(block, "dc:date");
    if (!title || !link) continue;
    const t = Date.parse(date);
    out.push({
      title,
      url: link.replace(/^http:\/\//, "https://"),
      at: Number.isFinite(t) ? t : null,
    });
  }
  return out;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 見出し

// 見出しは多すぎると読まれない。相場の前提に効くものだけを上に出す。
// 拾ったキーワードはタグとして表示し、なぜ載っているかを分かるようにする。
const FEEDS = [
  {
    source: "日本銀行",
    url: "https://www.boj.or.jp/rss/whatsnew.xml",
    keywords: [
      ["金融政策決定会合", "金融政策"],
      ["政策金利", "金融政策"],
      ["展望レポート", "金融政策"],
      ["主な意見", "金融政策"],
      ["総裁", "発言"],
      ["国債買入", "オペ"],
      ["短観", "景況"],
      ["経済・物価情勢", "見通し"],
      ["金融システムレポート", "見通し"],
      ["需給ギャップ", "景況"],
      ["物価", "物価"],
      ["為替", "為替"],
      ["マネーストック", "統計"],
      ["貸出", "統計"],
    ],
  },
  {
    source: "FRB",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    keywords: [
      ["fomc", "金融政策"],
      ["monetary policy", "金融政策"],
      ["interest rate", "金利"],
      ["discount rate", "金利"],
      ["balance sheet", "金融政策"],
      ["economic projections", "見通し"],
      ["minutes", "議事要旨"],
      ["speech", "発言"],
      ["chair", "発言"],
    ],
  },
  // 中央銀行だけだと「金融政策の話」しか出ない。実体経済の数字そのものを出す
  // 官庁を足して、株の前提が動いた日に見出しが並ぶようにする。
  //
  // 下記は実際に叩いて動いたものだけを載せている。試して駄目だったもの:
  //   JPX（東証）  … news.xml / news.rdf / index.rdf など5通り試して全て404。RSSが無い
  //   総務省統計局  … 404。統計局はRSSを出していない
  //   財務省        … 404
  //   米BLS         … 通常のUAでは403。ブラウザのUAを騙ると1件だけ返るが、
  //                    見出しが「Latest Numbers」1本きりで中身が無く、載せる意味がない
  //   米財務省      … 503。安定しない
  // 増やしたくなったら、まず curl で叩いてから足すこと。
  {
    source: "内閣府",
    url: "https://www.cao.go.jp/rss/news.rdf",
    keywords: [
      ["国民経済計算", "GDP"],
      ["四半期別GDP", "GDP"],
      ["景気動向指数", "景況"],
      ["月例経済報告", "景況"],
      ["消費動向調査", "消費"],
      ["機械受注", "設備投資"],
      ["景気ウォッチャー", "景況"],
      ["経済財政", "政策"],
    ],
  },
  {
    source: "米BEA",
    url: "https://apps.bea.gov/rss/rss.xml",
    keywords: [
      ["gross domestic product", "GDP"],
      ["gdp", "GDP"],
      ["personal income", "消費"],
      ["personal consumption", "消費"],
      ["corporate profits", "企業収益"],
      ["trade in goods", "貿易"],
    ],
  },
  {
    source: "米Census",
    url: "https://www.census.gov/economic-indicators/indicator.xml",
    keywords: [
      ["retail", "消費"],
      ["durable goods", "設備投資"],
      ["construction spending", "住宅"],
      ["new residential", "住宅"],
      ["international trade", "貿易"],
      ["business inventories", "在庫"],
    ],
  },
];

const DAY = 864e5;

async function fetchHeadlines(now) {
  const all = [];
  const failed = [];

  for (const feed of FEEDS) {
    try {
      const items = parseFeed(await getText(feed.url, feed.source));

      for (const it of items) {
        // 古い見出しを「今日のトピックス」に混ぜない
        if (it.at && now - it.at > 10 * DAY) continue;

        const hay = it.title.toLowerCase();
        const hit = feed.keywords.find(([k]) => hay.includes(k.toLowerCase()));

        // 相場の前提に効く語を含むものだけを載せる。
        // 中央銀行の公表物には行政手続きの類も多く、混ぜると読まれなくなる。
        if (!hit) continue;

        all.push({
          source: feed.source,
          title: it.title,
          url: it.url,
          date: it.at ? isoDay(it.at) : null,
          at: it.at ?? 0,
          tag: hit[1],
        });
      }
    } catch (err) {
      failed.push(`${feed.source}: ${err.message}`);
    }
  }

  all.sort((a, b) => b.at - a.at);

  // 1つのソースで埋め尽くさないよう、各3件までに制限する
  const perSource = {};
  const picked = [];
  for (const h of all) {
    perSource[h.source] = (perSource[h.source] ?? 0) + 1;
    // ソースが2本から5本に増えたので、1ソースあたりを2件に絞る。
    // 日銀は公表物が多く、緩めると日銀だけで埋まってしまう。
    if (perSource[h.source] > 2) continue;
    picked.push({ source: h.source, title: h.title, url: h.url, date: h.date, tag: h.tag });
    if (picked.length >= 6) break;
  }

  return { headlines: picked, failed };
}

// ---------------------------------------------------------------- カレンダー

// FRED のリリースIDと、その指標が6資産のどれに効くか。
// ここに無いリリースは出さない（毎日出る細かい金利データが混ざると読めなくなる）。
//
// 注意: FOMC（release_id 101）は将来日付が毎日返ってくる仕様のため使わない。
//       誤った予定を出すくらいなら出さないほうがいい。
const WATCHED = {
  10:  { name: "米CPI（消費者物価）",       why: "米金利と金の前提が動く" },
  50:  { name: "米雇用統計",                 why: "利下げ観測が動き、ドル円に効く" },
  54:  { name: "米PCE（個人消費・物価）",   why: "FRBが最も重視する物価指標" },
  46:  { name: "米PPI（生産者物価）",        why: "CPIの先行指標" },
  53:  { name: "米GDP",                      why: "景気の全体像" },
  9:   { name: "米小売売上高",               why: "個人消費の強さ" },
  192: { name: "米求人件数（JOLTS）",        why: "労働需給のゆるみ" },
  180: { name: "米新規失業保険申請",         why: "毎週出る雇用の速報" },
  13:  { name: "米鉱工業生産",               why: "製造業の体温" },
};

async function fetchCalendar(fredKey, now) {
  if (!fredKey) return { calendar: [], failed: ["FRED: APIキー未設定"] };

  const start = isoDay(now - 1 * DAY);
  const end = isoDay(now + 14 * DAY);

  // 全リリースを一度に取る releases/dates は1000行を超えて重く、時間切れになりやすい。
  // 見たい9本を個別に、同時に叩くほうが速くて確実だった。
  const jobs = Object.entries(WATCHED).map(async ([id, w]) => {
    const url =
      `https://api.stlouisfed.org/fred/release/dates` +
      `?release_id=${id}&api_key=${fredKey}&file_type=json` +
      `&realtime_start=${start}&realtime_end=${end}` +
      `&include_release_dates_with_no_data=true&sort_order=asc&limit=20`;

    const json = JSON.parse(await getText(url, `FRED ${w.name}`));
    return (json.release_dates ?? []).map((d) => ({ date: d.date, name: w.name, why: w.why }));
  });

  const settled = await Promise.allSettled(jobs);
  const calendar = [];
  const failed = [];

  for (const r of settled) {
    if (r.status === "fulfilled") calendar.push(...r.value);
    else failed.push(`FRED カレンダー: ${r.reason?.message ?? r.reason}`);
  }

  calendar.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { calendar, failed };
}

// ---------------------------------------------------------------- 本体

/**
 * 見出しと発表予定を集めて topics.json の中身を返す。
 * 失敗しても例外は投げず、取れたぶんだけ返す。
 */
export async function fetchTopics({ fredKey, now = Date.now() } = {}) {
  const [h, c] = await Promise.all([fetchHeadlines(now), fetchCalendar(fredKey, now)]);

  // 米指標の発表日は現地日付。日本で読むと「日本時間では翌日の未明」になるため、
  // 画面側で「今夜」と書けるよう、日付だけを渡して解釈は表示側に任せる。
  return {
    generatedAt: new Date(now).toISOString(),
    today: isoDay(now),
    calendar: c.calendar,
    headlines: h.headlines,
    failed: [...h.failed, ...c.failed],
  };
}
