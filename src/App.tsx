import { useEffect, useState } from "react";
import type { Correlation, Highlights as HighlightsData, History, Latest } from "./types";
import AssetCard from "./components/AssetCard";
import Highlights from "./components/Highlights";
import Portfolio from "./components/Portfolio";
import CorrelationMatrix from "./components/CorrelationMatrix";
import OverlayChart from "./components/OverlayChart";
import TodayNote from "./components/TodayNote";

// public/ 配下は base 基準で配信される。ビルド後もそのまま解決される書き方。
const BASE = import.meta.env.BASE_URL;

async function loadJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`);
  if (!res.ok) throw new Error(`${name} を読めませんでした (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export default function App() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [correlation, setCorrelation] = useState<Correlation | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [highlights, setHighlights] = useState<HighlightsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    Promise.all([
      loadJSON<Latest>("latest.json"),
      loadJSON<Correlation>("correlation.json"),
      loadJSON<History>("history.json"),
      loadJSON<HighlightsData>("highlights.json"),
    ])
      .then(([l, c, h, hl]) => {
        if (!alive) return;
        setLatest(l);
        setCorrelation(c);
        setHistory(h);
        setHighlights(hl);
      })
      .catch((err: Error) => alive && setError(err.message));

    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="app">
        <p className="state">
          {error}
          <br />
          <code>npm run fetch</code> を実行してデータを作ってください。
        </p>
      </div>
    );
  }

  if (!latest || !correlation || !history || !highlights) {
    return (
      <div className="app">
        <p className="state">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="brand">
          ヨコグシ
          <span>株・金・ビットコインを1画面で</span>
        </h1>
        <p className="as-of">{latest.asOf} 時点</p>
      </header>

      <main>
        <div className="grid">
          {latest.assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>

        <Highlights data={highlights} assets={latest.assets} />

        <Portfolio
          assets={latest.assets}
          matrix={correlation.windows.d90}
          shifts={highlights.shifts}
        />

        <CorrelationMatrix assets={latest.assets} correlation={correlation} />

        <OverlayChart assets={latest.assets} history={history} />

        <TodayNote base={BASE} />
      </main>

      <footer className="footnote">
        <p>
          出典: FRED（米セントルイス連銀） / Frankfurter（ECB） / CoinGecko。
          金は PAXG（金地金を裏付けとするトークン）の価格を用いた暫定値です。
        </p>
        <p>本サイトは情報提供を目的としたものであり、投資勧誘や投資助言ではありません。</p>
      </footer>
    </div>
  );
}
