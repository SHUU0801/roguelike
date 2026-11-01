/**
 * 手で用意した1枚絵から、ゲームが使うシートを切り出す。
 *
 *   npm run art            -- 下見（どこを切るかだけ出す。書き込まない）
 *   npm run art -- --write -- 実際に書き出す
 *
 * ## なぜ切り出しが要るか
 *
 * 配られる絵は「職業名のラベル + 128 の列 + 16 の列」が1枚に並んだ一覧で、
 * ゲームが読む並び（1職業1行・コマが横に隣り合う）とは違う。
 * 手で切ると、絵を描き直すたびに同じ作業が要る。ここに閉じ込める。
 *
 * ## 位置をどうやって決めるか
 *
 * 座標を決め打ちにしない。**絵のある塊を自分で探す。**
 * 背景（白または透明）でない画素を行ごと・列ごとに数えて、
 * 途切れているところで区切る。ラベルの文字も塊として拾ってしまうので、
 * 「高さが 128 に近い帯」「高さが 16 に近い帯」だけを採る。
 *
 * 絵の中身を加工はしない。切って並べ替えるだけ。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(here, '../art/source');

/**
 * 元絵を探す。
 *
 * characters.png が本命だが、**名前が違っても拾う。**
 * 「characters (1).png」のまま置かれて動かない、で1往復するのが無駄なので、
 * art/source に PNG が1枚だけあればそれを使う。
 */
function findSource() {
  const named = resolve(SRC_DIR, 'characters.png');
  if (existsSync(named)) return named;
  if (!existsSync(SRC_DIR)) return null;
  const pngs = readdirSync(SRC_DIR).filter((f) => f.toLowerCase().endsWith('.png'));
  if (pngs.length === 1) return resolve(SRC_DIR, pngs[0]);
  if (pngs.length > 1) {
    console.log(`PNG が ${pngs.length} 枚ある。1枚にするか characters.png という名前にする:`);
    for (const f of pngs) console.log(`  ${f}`);
  }
  return null;
}

/** 絵の並び順。一覧の上から順に、ゲーム側の職業 id へ対応づける */
const JOBS = ['warrior', 'rogue', 'mage', 'cleric'];

/** 背景とみなす色か。透明か、ほぼ白 */
function isBlank(px, i) {
  if (px[i + 3] < 16) return true;
  return px[i] > 244 && px[i + 1] > 244 && px[i + 2] > 244;
}

/** 行ごとに「絵のある画素」を数える */
function rowInk(img) {
  const { width, height, px } = img;
  const out = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (!isBlank(px, (y * width + x) * 4)) n++;
    out[y] = n;
  }
  return out;
}

/** 連続して中身のあるところを帯として拾う */
function bands(ink, minGap = 2) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] > 0) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap) {
        out.push({ from: start, to: i - gap });
        start = -1;
      }
    }
  }
  if (start >= 0) out.push({ from: start, to: ink.length - 1 });
  return out;
}

/** その帯の中で、列ごとに中身のある塊を拾う */
function columnsIn(img, from, to, minGap = 3) {
  const { width, px } = img;
  const ink = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = from; y <= to; y++) if (!isBlank(px, (y * width + x) * 4)) n++;
    ink[x] = n;
  }
  return bands(ink, minGap);
}

/** 元画像の矩形を、tile×tile の枠の中央に置いて切り出す */
function cut(img, box, tile) {
  const out = new Uint8Array(tile * tile * 4);
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  if (w > tile || h > tile) {
    throw new Error(`枠(${tile})より大きい塊がある: ${w}x${h} @ ${box.x0},${box.y0}`);
  }
  // 横は中央、縦は下ぞろえ。立ち絵は足元が揃っていないと並べたとき浮く
  const ox = Math.floor((tile - w) / 2);
  const oy = tile - h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((box.y0 + y) * img.width + (box.x0 + x)) * 4;
      if (isBlank(img.px, s)) continue;
      const d = ((oy + y) * tile + (ox + x)) * 4;
      out[d] = img.px[s];
      out[d + 1] = img.px[s + 1];
      out[d + 2] = img.px[s + 2];
      out[d + 3] = img.px[s + 3];
    }
  }
  return out;
}

/** 帯と列から、実際に中身のある矩形まで詰める */
function tighten(img, x0, x1, y0, y1) {
  let a = y1;
  let b = y0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isBlank(img.px, (y * img.width + x) * 4)) {
        if (y < a) a = y;
        if (y > b) b = y;
        break;
      }
    }
  }
  return { x0, x1, y0: a, y1: b };
}

/* ── 本体 ──────────────────────────────────────────── */

function main() {
  const src = findSource();
  if (!src) {
    console.log(`元絵が無い: ${resolve(SRC_DIR, 'characters.png')}`);
    console.log('この場所に1枚絵を置いてから、もう一度走らせる。');
    process.exitCode = 1;
    return;
  }

  const img = decodePng(readFileSync(src));
  console.log(`元絵: ${src}`);
  console.log(`大きさ: ${img.width}x${img.height}`);

  // 高さで「128 の段」と「16 の段」を見分ける。ラベルの文字は高さが合わないので落ちる
  const all = bands(rowInk(img));
  const big = all.filter((b) => b.to - b.from + 1 >= 90);
  const small = all.filter((b) => {
    const h = b.to - b.from + 1;
    return h >= 10 && h <= 40;
  });

  console.log(`高い段 ${big.length} 本 / 低い段 ${small.length} 本`);
  for (const b of big) console.log(`  高 y=${b.from}..${b.to} (${b.to - b.from + 1})`);
  for (const b of small) console.log(`  低 y=${b.from}..${b.to} (${b.to - b.from + 1})`);

  if (big.length !== JOBS.length) {
    console.log(`※ 高い段が ${JOBS.length} 本見つからない。元絵の余白か背景色を見直す`);
  }

  const write = process.argv.includes('--write');
  const plan = [];

  for (let j = 0; j < Math.min(big.length, JOBS.length); j++) {
    const cols = columnsIn(img, big[j].from, big[j].to);
    // 左端はラベル。128 に収まらない幅のものは落とす
    const poses = cols.filter((c) => {
      const w = c.to - c.from + 1;
      return w >= 24 && w <= 128;
    });
    plan.push({ job: JOBS[j], band: big[j], poses });
    console.log(`${JOBS[j]}: ポーズ ${poses.length} 枚`);
  }

  if (!write) {
    console.log('\n下見だけ。書き出すなら -- --write');
    return;
  }

  const frames = Math.min(...plan.map((p) => p.poses.length));
  if (!Number.isFinite(frames) || frames < 1) {
    console.log('切り出せる絵が無かった');
    process.exitCode = 1;
    return;
  }

  const TILE = 128;
  const W = frames * TILE;
  const H = plan.length * TILE;
  const out = new Uint8Array(W * H * 4);

  plan.forEach((p, row) => {
    p.poses.slice(0, frames).forEach((c, col) => {
      const box = tighten(img, c.from, c.to, p.band.from, p.band.to);
      const cell = cut(img, box, TILE);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const s = (y * TILE + x) * 4;
          const d = ((row * TILE + y) * W + (col * TILE + x)) * 4;
          out[d] = cell[s];
          out[d + 1] = cell[s + 1];
          out[d + 2] = cell[s + 2];
          out[d + 3] = cell[s + 3];
        }
      }
    });
  });

  const dest = resolve(here, '../public/sprites/portraits.png');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, encodePng(W, H, out));
  console.log(`${dest} （${W}x${H}, 1職業 ${frames} コマ）`);
  console.log('src/shared/sprites.ts の PORTRAIT_SHEET の cols をこのコマ数に合わせること');
}

main();
