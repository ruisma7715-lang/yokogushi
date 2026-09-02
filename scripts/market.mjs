// ヨコグシ — 今日の市場（米国・日本の株式市場の内訳）
//
// 6資産のカードは「横断」のためのもので、増やすと1画面に収まらなくなる。
// だが「今日の米株がどう動いたか」は指数を1本見ても分からない。大型ハイテクだけが
// 買われた日と、全部がそろって上げた日は、同じ +0.5% でも意味が違う。
//
// そこでカードには出さず、トピックスの中だけで使う指数をここで集める。
// 集めるのは一次データのみ（FRED）。記事の転載やスクレイピングはしない。
//
// 日付について。ヨコグシには「横断の共通日(alignedAsOf)」と「資産ごとの最新日」の
// 2つがあるが、ここで使うのはそのどちらでもない第3の軸で、
// 「米国の指数どうしが揃った日」である。ナスダックとダウを比べる話なので、
// 同じ日の値でなければ比較が成立しない。日本は日経平均1本なのでその最新日を使う。
// 混ざらないよう、us と jp がそれぞれ自分の asOf を持つ。

const DAYS = 150; // 52週の値幅までは要らない。前日比・週次・60日平均が出れば足りる
const TIMEOUT = 20000;

// カードに出す6資産とは別。ここは「米株の中の内訳」を見るためだけの指数。
const US_INDICES = [
  { id: "sp500", name: "S&P 500",      code: null,          note: "大型500社" },
  { id: "ndx",   name: "ナスダック100", code: "NASDAQ100",   note: "大型ハイテク" },
  { id: "dow",   name: "ダウ工業株30種", code: "DJIA",       note: "旧来型の大型" },
  { id: "comp",  name: "ナスダック総合", code: "NASDAQCOM",  note: "ハイテク全体" },
];

const VIX = { code: "VIXCLS", name: "VIX" };

// ---------------------------------------------------------------- 取得

async function fromFred(code, fredKey) {
  const start = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${code}&api_key=${fredKey}&file_type=json&observation_start=${start}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`FRED ${code}: HTTP ${res.status}`);
  const json = await res.json();

  const out = {};
  for (const o of json.observations ?? []) {
    if (o.value === "." || o.value === "") continue; // 休場日
    const v = Number(o.value);
    if (Number.isFinite(v)) out[o.date] = v;
  }
  return out;
}

// ---------------------------------------------------------------- 小道具

const sortedDays = (series) => Object.keys(series ?? {}).sort();

/** 指定日から n 営業日前と比べた変化率(%)。データが足りなければ null */
function pctBack(series, asOf, back) {
  const days = sortedDays(series);
  const at = days.indexOf(asOf);
  const from = at - back;
  if (at < 0 || from < 0) return null;
  const a = series[days[from]];
  const b = series[asOf];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return Number(((b / a - 1) * 100).toFixed(2));
}

/** 複数系列で値が揃った最新日。揃う日が無ければ null */
function alignedLatest(seriesList) {
  const live = seriesList.filter((s) => s && Object.keys(s).length);
  if (!live.length) return null;

  const days = sortedDays(live[0]);
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (live.every((s) => Number.isFinite(s[day]))) return day;
  }
  return null;
}

const signed = (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

// ---------------------------------------------------------------- 文章
//
// 書けるのは「起きたこと」と「その事実が何に効くか」まで。
// 投資助言業の登録が無いため、「〜だろう」「〜すべき」は使わない。

function describeUS(indices, vix, asOf) {
  const lines = [];
  const withPct = indices.filter((x) => x.changeDay !== null);
  if (withPct.length < 2) return lines;

  const sorted = [...withPct].sort((a, b) => b.changeDay - a.changeDay);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const allUp = sorted.every((x) => x.changeDay > 0);
  const allDown = sorted.every((x) => x.changeDay < 0);
  const spread = top.changeDay - bottom.changeDay;

  if (allUp || allDown) {
    const dir = allUp ? "上昇" : "下落";
    if (spread < 0.5) {
      lines.push(
        `米国の主要指数はそろって${dir}しました（${signed(bottom.changeDay)}%〜${signed(top.changeDay)}%）。買われた先が偏っていない一日です。`
      );
    } else {
      lines.push(
        `米国株は全体が${dir}しましたが、${top.name}の ${signed(top.changeDay)}% に対し${bottom.name}は ${signed(bottom.changeDay)}%。値動きの幅が ${spread.toFixed(2)} ポイント開いています。`
      );
    }
  } else {
    lines.push(
      `${top.name}が ${signed(top.changeDay)}%、${bottom.name}が ${signed(bottom.changeDay)}%。同じ米国株でも方向が分かれた一日です（${top.note}と${bottom.note}の違い）。`
    );
  }

  if (vix && vix.value !== null) {
    // VIXは指数と同じ日に揃わないことがある。遅れているときだけ日付を添える
    // （揃っている日にも書くと、どれが古いのか分からなくなる）。
    const when =
      vix.asOf && vix.asOf !== asOf
        ? `${Number(vix.asOf.slice(5, 7))}/${Number(vix.asOf.slice(8, 10))}時点の`
        : "";
    const chg = vix.changeDay;
    if (chg !== null && Math.abs(chg) >= 10) {
      lines.push(
        `${when}VIXは前日から ${signed(chg)}% 動いて ${vix.value.toFixed(2)}。株式市場が見込む先行きの振れ幅の見積もりが${chg > 0 ? "広がり" : "縮み"}ました。`
      );
    } else if (vix.avg60 !== null) {
      const hi = vix.value > vix.avg60;
      lines.push(
        `${when}VIXは ${vix.value.toFixed(2)}。60日平均の ${vix.avg60.toFixed(2)} を${hi ? "上回って" : "下回って"}おり、株式市場が見込む先行きの振れ幅は平常より${hi ? "大きめ" : "小さめ"}です。`
      );
    }
  }

  return lines;
}

function describeJP(nikkei, usdNikkeiPct, range52) {
  const lines = [];
  if (!nikkei || nikkei.changeDay === null) return lines;

  let head = `日経平均は ${signed(nikkei.changeDay)}%`;
  if (nikkei.changeWeek !== null) head += `、この1週間では ${signed(nikkei.changeWeek)}%`;
  if (range52 !== null) {
    head += `。過去1年の値幅の中では下から ${Math.round(range52)}% の位置です。`;
  } else {
    head += "。";
  }
  lines.push(head);

  // 円建てとドル建てで日経平均の意味は変わる。海外から見た日本株がどうだったかは、
  // 為替を抜かないと分からない。これは横断サイトでしか出せない視点。
  if (usdNikkeiPct !== null && Math.abs(usdNikkeiPct - nikkei.changeDay) >= 0.3) {
    const weaker = usdNikkeiPct < nikkei.changeDay;
    lines.push(
      `ドル建てでは ${signed(usdNikkeiPct)}%。円${weaker ? "安" : "高"}のぶん、海外から見た日本株の${weaker ? "上げは円建てほど大きくありません" : "動きは円建てより大きくなっています"}。`
    );
  }

  return lines;
}

// ---------------------------------------------------------------- 本体

/**
 * 今日の市場を組み立てる。
 * すでに fetch.mjs が取得済みの系列は known で受け取り、二重に叩かない。
 *
 * @param {object}  o
 * @param {string}  o.fredKey
 * @param {object}  o.known  { nikkei, sp500, usdjpy } の { "YYYY-MM-DD": 値 }
 */
export async function fetchMarketInternals({ fredKey, known = {} }) {
  const failed = [];
  if (!fredKey) return { us: null, jp: null, failed: ["FRED: APIキー未設定"] };

  // 新しく叩くのは4系列だけ。S&P500・日経平均・ドル円は呼び出し側から受け取る。
  const codes = [...US_INDICES.filter((x) => x.code).map((x) => x.code), VIX.code];
  const got = await Promise.allSettled(codes.map((c) => fromFred(c, fredKey)));

  const series = { sp500: known.sp500 ?? null };
  codes.forEach((code, i) => {
    const r = got[i];
    if (r.status === "fulfilled") series[code] = r.value;
    else failed.push(r.reason?.message ?? `FRED ${code}: 取得失敗`);
  });
  for (const x of US_INDICES) if (x.code) series[x.id] = series[x.code] ?? null;

  // --- 米国。指数どうしを比べる話なので、揃った日でなければ意味がない。
  let us = null;
  const usSeries = US_INDICES.map((x) => series[x.id]).filter(Boolean);
  const usAsOf = alignedLatest(usSeries);

  if (usAsOf) {
    const indices = US_INDICES.filter((x) => series[x.id]).map((x) => ({
      id: x.id,
      name: x.name,
      note: x.note,
      value: Number(series[x.id][usAsOf].toFixed(2)),
      changeDay: pctBack(series[x.id], usAsOf, 1),
      changeWeek: pctBack(series[x.id], usAsOf, 5),
    }));

    // VIXは水準そのものに意味があるので、変化率より値と平均との距離を見る。
    // 指数と同じ日に揃わないこともあるため、VIX自身の最新日で扱う。
    let vix = null;
    const vixSeries = series[VIX.code];
    const vixDays = sortedDays(vixSeries);
    if (vixDays.length) {
      const vixAsOf = vixDays[vixDays.length - 1];
      const recent = vixDays.slice(-60).map((d) => vixSeries[d]);
      const avg60 = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : null;
      vix = {
        asOf: vixAsOf,
        value: vixSeries[vixAsOf],
        changeDay: pctBack(vixSeries, vixAsOf, 1),
        avg60: avg60 === null ? null : Number(avg60.toFixed(2)),
      };
    }

    us = { asOf: usAsOf, indices, vix, lines: describeUS(indices, vix, usAsOf) };
  } else {
    failed.push("米国指数: 値が揃った日がありません");
  }

  // --- 日本。日経平均1本しか無料で日次に取れないので、内訳は出さない。
  //     代わりに為替を抜いたドル建ての動きを添える（横断サイトの持ち味）。
  let jp = null;
  const nk = known.nikkei;
  const nkDays = sortedDays(nk);

  if (nkDays.length >= 2) {
    const jpAsOf = nkDays[nkDays.length - 1];
    const nikkei = {
      id: "nikkei",
      name: "日経平均",
      value: Number(nk[jpAsOf].toFixed(2)),
      changeDay: pctBack(nk, jpAsOf, 1),
      changeWeek: pctBack(nk, jpAsOf, 5),
    };

    // 値幅の中の位置。高値圏か安値圏かは、率だけ見ていても分からない。
    // 「過去1年」と書く以上、1年ぶん揃っていない日は出さない（短い期間の値幅を
    // 1年と呼ぶと、数字は出るが意味が違うものになる）。
    const window = nkDays.slice(-250).map((d) => nk[d]);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    const range52 =
      window.length >= 200 && hi > lo ? ((nk[jpAsOf] - lo) / (hi - lo)) * 100 : null;

    // ドル建て日経＝円建て ÷ ドル円。両方が揃った日でしか出せない。
    let usdNikkeiPct = null;
    const fx = known.usdjpy;
    if (fx) {
      const usd = {};
      for (const d of nkDays) if (Number.isFinite(fx[d])) usd[d] = nk[d] / fx[d];
      const usdDays = sortedDays(usd);
      if (usdDays.length >= 2) usdNikkeiPct = pctBack(usd, usdDays[usdDays.length - 1], 1);
    }

    jp = {
      asOf: jpAsOf,
      indices: [nikkei],
      range52: range52 === null ? null : Number(range52.toFixed(1)),
      usdChangeDay: usdNikkeiPct,
      lines: describeJP(nikkei, usdNikkeiPct, range52),
    };
  }

  return { us, jp, failed };
}
