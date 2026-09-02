// ヨコグシ — アイコンと共有画像の生成
//
// ホーム画面のアイコンとOGP画像を作る。画像ライブラリを依存に足したくないので
// （このプロジェクトの依存は React と Vite だけ）、PNG は自前で書き出す。
// Node に zlib があるので、生ピクセルを組んで圧縮すればそれだけで PNG になる。
//
// 毎回のデータ取得では動かさない。絵柄を変えたときだけ手で実行し、結果をコミットする。
//   node scripts/icons.mjs
//
// 絵柄は名前のとおり「横串」。6本の柱（6資産）を1本の横線が貫いている。
// 資産の識別色は src/styles.css のトークンと同じ並びにしてある。

import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

const BG = [15, 23, 32]; // --ink
const SKEWER = [237, 242, 247];

// src/styles.css の --a-* と同じ。並び順も画面のカードと揃える。
const ASSETS = [
  [42, 120, 214], // 日経平均
  [235, 104, 52], // S&P 500
  [27, 175, 122], // ドル円
  [237, 161, 0], // 金
  [232, 123, 164], // ビットコイン
  [0, 131, 0], // 米10年債利回り
];

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA のピクセル配列を PNG にする */
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // カラータイプ: RGBA
  // 10..12 は圧縮・フィルタ・インタレースで、いずれも 0

  // 各行の先頭にフィルタ種別のバイトが要る。0（フィルタなし）で通す。
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 描画

function canvas(w, h, bg) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}

function rect(px, w, h, x0, y0, rw, rh, color) {
  const x1 = Math.min(w, Math.round(x0 + rw));
  const y1 = Math.min(h, Math.round(y0 + rh));
  for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
    for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
      const i = (y * w + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

// 5x7 のビットマップ。OGP画像に載せる YOKOGUSHI の9文字ぶんだけ持つ。
// 日本語はフォントが要るので入れない（英字だけで足りる用途にしてある）。
const GLYPHS = {
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
};

function text(px, w, h, str, x0, y0, scale, color, gap) {
  let x = x0;
  for (const ch of str) {
    const g = GLYPHS[ch];
    if (!g) {
      x += (5 + gap) * scale;
      continue;
    }
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === "1") rect(px, w, h, x + c * scale, y0 + r * scale, scale, scale, color);
      }
    }
    x += (5 + gap) * scale;
  }
  return x;
}

/**
 * ホーム画面のアイコン。6本の柱を1本の横線が貫く。
 *
 * padRatio を大きくすると絵が内側に寄る。Android の maskable は端が円形に
 * 切られるため、通常版と同じ余白だと横串の両端が欠ける。専用に太らせて渡す。
 */
function icon(size, padRatio = 0.17) {
  const px = canvas(size, size, BG);

  const pad = size * padRatio;
  const inner = size - pad * 2;
  const slot = inner / 6;
  const barW = slot * 0.56;

  // 柱の高さはばらつかせる。全部同じだと「並んでいる」だけで「相場」に見えない。
  const ratios = [0.52, 0.78, 0.4, 0.92, 0.62, 0.34];

  ratios.forEach((r, i) => {
    const bh = inner * r;
    rect(px, size, size, pad + slot * i + (slot - barW) / 2, pad + inner - bh, barW, bh, ASSETS[i]);
  });

  // 横串。これが名前の由来なので、柱より前に、はっきり通す。
  const lineH = Math.max(2, size * 0.055);
  rect(px, size, size, pad * 0.55, size / 2 - lineH / 2, size - pad * 1.1, lineH, SKEWER);

  return encodePNG(size, size, px);
}

/** 共有カード。LINEやXに貼ったときに出る画像。 */
function ogp() {
  const w = 1200;
  const h = 630;
  const px = canvas(w, h, BG);

  // 左に柱、右に名前。柱はアイコンと同じ絵柄にして、見た目を揃える。
  const bx = 110;
  const bw = 420;
  const bottom = 460;
  const slot = bw / 6;
  const barW = slot * 0.56;
  const ratios = [0.52, 0.78, 0.4, 0.92, 0.62, 0.34];

  ratios.forEach((r, i) => {
    const bh = 300 * r;
    rect(px, w, h, bx + slot * i + (slot - barW) / 2, bottom - bh, barW, bh, ASSETS[i]);
  });
  rect(px, w, h, bx - 34, 330, bw + 68, 14, SKEWER);

  // 文字と色帯を、柱のかたまりの中心（およそ y=322）に対して縦に揃える。
  // 文字7段 + 間 + 色帯12px を1つの塊として扱う。
  const tx = 630;
  const scale = 8;
  text(px, w, h, "YOKOGUSHI", tx, 273, scale, SKEWER, 2);

  // 名前の下に、資産の色を並べた帯を敷く。何のサイトかを色で示す。
  // 幅は文字列の実寸に合わせる（9文字 × (5+2) × scale）。
  const tw = 9 * (5 + 2) * scale - 2 * scale;
  const sw = tw / 6;
  ASSETS.forEach((c, i) => rect(px, w, h, tx + i * sw, 359, sw - 14, 12, c));

  return encodePNG(w, h, px);
}

// ---------------------------------------------------------------- 本体

await mkdir(OUT, { recursive: true });

const files = [
  ["icon-192.png", icon(192)],
  ["icon-512.png", icon(512)],
  ["icon-maskable-512.png", icon(512, 0.28)], // 端を円形に切られても欠けない余白
  ["apple-touch-icon.png", icon(180)], // iOS はこの名前と180pxを見る
  ["favicon-32.png", icon(32)],
  ["ogp.png", ogp()],
];

for (const [name, buf] of files) {
  await writeFile(join(OUT, name), buf);
  console.log(`  ${name.padEnd(22)} ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log("\n  アイコンと共有画像を書き出しました（public/）");
