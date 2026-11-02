/**
 * 手で用意した1枚絵から、ゲームが使うシートを切り出す。
 *
 *   npm run art            -- 下見（どこを切るかだけ出す。書き込まない）
 *   npm run art -- --write -- 実際に書き出す
 *
 * ## 元絵
 *
 * `art/source/characters.png`。職業の一覧で、1職業につき2段:
 *
 *   ラベル │ 大きい姿 ×8ポーズ
 *          │ 小さい姿 ×8ポーズ
 *
 * ゲームが読むのはこの2枚:
 *   public/sprites/portraits.png  128×128 立ち絵（ホーム）
 *   public/sprites/jobs.png        16×16  盤の上の姿
 *
 * ## 決め打ちにしないこと
 *
 * 座標を直書きしない。絵を描き直すたびに合わなくなる。
 * 代わりに**中身のある塊を自分で探す。**
 *
 * ただし、探し方には元絵の作りを1つだけ前提にしている：
 * **小さい姿の段は必ず8列きれいに分かれる。** 大きい姿のほうは
 * 斬撃や光のエフェクトが隣の枠にはみ出して、2つの姿が1つの塊に
 * 繋がってしまうことがある（実際ファイターの2番目と3番目が繋がった）。
 * なので**列の切れ目は小さい段から決めて、大きい段にも同じ切れ目を使う。**
 *
 * ## 背景の見分け方
 *
 * 「白っぽい画素は背景」では駄目だった。僧侶の法衣が生成り色で、
 * 一緒に消える。**縁から白を塗りつぶして（flood fill）繋がっている
 * ところだけ背景**とみなす。中の白は輪郭で囲まれているので残る。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(here, '../art/source');

/** 絵の並び順。一覧の上から順に、ゲーム側の職業 id へ対応づける */
const JOBS = ['warrior', 'rogue', 'mage', 'cleric'];
/** 1職業あたりのポーズ数 */
const POSES = 8;
/** ラベルの列。ここから右だけを見る */
const LABEL_W = 170;

const PORTRAIT_TILE = 128;
/*
 * 盤の上の姿の大きさ。
 *
 * 元絵の小さいほうは 45px ほどある。**16 に縮めたら潰れて読めなかった**
 * （実機で見たら、鎧も顔も分からない黒い塊になった）。
 * 盤のマスは実測 39px で描かれるので、32 ならほぼ等倍で見られる。
 * 床や壁は 16 のままだが、人だけ細かいのは見慣れた作りなので気にしない。
 */
const BOARD_TILE = 32;

/* ── 元絵を探す ────────────────────────────────────── */

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

/* ── 背景を見つける ────────────────────────────────── */

/**
 * 縁から白を塗りつぶして、外に繋がっている白だけを背景にする。
 *
 * 「白っぽい画素は全部背景」にしたら、僧侶の法衣（生成り）まで消えた。
 * 中の白は輪郭に囲まれていて外と繋がっていないので、この方法なら残る。
 */
function findBackground(img) {
  const { width, height, px } = img;
  const bg = new Uint8Array(width * height);
  const whiteish = (i) => px[i + 3] < 16 || (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235);

  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (bg[p]) return;
    if (!whiteish(p * 4)) return;
    bg[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p / width) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return bg;
}

/* ── 帯と列 ────────────────────────────────────────── */

function bandsOf(ink, minGap) {
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

function rowBands(img, bg) {
  const { width, height } = img;
  const ink = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = LABEL_W; x < width; x++) if (!bg[y * width + x]) n++;
    ink[y] = n;
  }

  // 段と段がくっついていたら、中が一番薄いところで割る
  const out = [];
  for (const b of bandsOf(ink, 2)) {
    if (b.to - b.from + 1 <= 140) {
      out.push(b);
      continue;
    }
    let cut = -1;
    let best = Infinity;
    // 端のほうで割らない。真ん中あたりだけ見る
    for (let y = b.from + 40; y <= b.to - 30; y++) {
      if (ink[y] < best) {
        best = ink[y];
        cut = y;
      }
    }
    out.push({ from: b.from, to: cut - 1 }, { from: cut + 1, to: b.to });
  }
  return out;
}

function columnCenters(img, bg, band) {
  const { width } = img;
  const ink = new Array(width).fill(0);
  for (let x = LABEL_W; x < width; x++) {
    let n = 0;
    for (let y = band.from; y <= band.to; y++) if (!bg[y * width + x]) n++;
    ink[x] = n;
  }
  return bandsOf(ink, 3).map((b) => (b.from + b.to) / 2);
}

/* ── 切り出し ──────────────────────────────────────── */

/**
 * 枠の中から、その姿だけを取り出す。
 *
 * 隣の枠の斬撃や光が切れ目をまたいで入ってくる。そのまま詰めると
 * 枠の端に細い縦の切れ端が残る（実際、ファイターと魔法使いで出た）。
 *
 * 繋がっている塊ごとに分けて、**枠の左右にぴったり接していて細いもの**を捨てる。
 * 魔法使いの浮いている玉のように、離れていても太いものは残す。
 */
function extractCell(img, bg, x0, x1, y0, y1) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const label = new Int32Array(w * h).fill(-1);
  const blobs = [];

  for (let i = 0; i < w * h; i++) {
    if (label[i] >= 0) continue;
    const sx = i % w;
    const sy = (i / w) | 0;
    if (bg[(y0 + sy) * img.width + (x0 + sx)]) continue;

    const id = blobs.length;
    const blob = { n: 0, x0: sx, x1: sx, y0: sy, y1: sy };
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w;
      const py = (p / w) | 0;
      blob.n++;
      if (px < blob.x0) blob.x0 = px;
      if (px > blob.x1) blob.x1 = px;
      if (py < blob.y0) blob.y0 = py;
      if (py > blob.y1) blob.y1 = py;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (label[q] >= 0) continue;
        if (bg[(y0 + ny) * img.width + (x0 + nx)]) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    blobs.push(blob);
  }

  if (blobs.length === 0) return null;

  const biggest = blobs.reduce((a, b) => (b.n > a.n ? b : a));
  const keep = blobs.map((b) => {
    if (b === biggest) return true;
    const touchesEdge = b.x0 === 0 || b.x1 === w - 1;
    if (!touchesEdge) return true;
    // 枠に接しているものは、細いか縦長なら隣から入ってきた切れ端とみなす
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    return bw >= 16 && bh / bw <= 3;
  });

  let ax = w;
  let bx = -1;
  let ay = h;
  let by = -1;
  blobs.forEach((b, i) => {
    if (!keep[i]) return;
    if (b.x0 < ax) ax = b.x0;
    if (b.x1 > bx) bx = b.x1;
    if (b.y0 < ay) ay = b.y0;
    if (b.y1 > by) by = b.y1;
  });
  if (bx < 0) return null;

  return {
    box: { x0: x0 + ax, x1: x0 + bx, y0: y0 + ay, y1: y0 + by },
    /** そこを絵として使うか。捨てた切れ端は透明にする */
    isInk: (x, y) => {
      const lx = x - x0;
      const ly = y - y0;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
      const id = label[ly * w + lx];
      return id >= 0 && keep[id];
    },
  };
}

/**
 * 矩形を tile×tile の枠へ縮めて置く。
 *
 * 行き先1画素ぶんの元画素をまとめて平均する（面積平均）。
 * 1画素ずつ間引くと、細い線が丸ごと消えて別の絵になる。
 *
 * 背景は透明として扱い、色は不透明度で重みを付けてから混ぜる。
 * そうしないと縁に白が滲む。
 *
 * 横は中央、縦は**下ぞろえ。** 立ち絵も盤の姿も、足元が揃っていないと
 * 並べたとき浮いたり沈んだりして見える。
 *
 * **倍率は外から渡す。** 以前は枠に収まるよう1枚ずつ計算していたが、
 * そうすると**ポーズごとにキャラの大きさが変わる。**
 * 斬撃のエフェクトで横に広い攻撃の絵は、その分だけ縮められて、
 * **殴るたびにキャラが小さくなって見えた。**
 * 同じ職業のコマは同じ倍率で切ること。
 */
function resampleInto(img, isInk, box, tile, pad, scale) {
  const out = new Uint8Array(tile * tile * 4);
  const sw = box.x1 - box.x0 + 1;
  const sh = box.y1 - box.y0 + 1;

  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const ox = Math.round((tile - dw) / 2);
  const oy = tile - pad - dh;

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = box.x0 + (dx / dw) * sw;
      const sx1 = box.x0 + ((dx + 1) / dw) * sw;
      const sy0 = box.y0 + (dy / dh) * sh;
      const sy1 = box.y0 + ((dy + 1) / dh) * sh;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = Math.floor(sy0); y < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); y++) {
        for (let x = Math.floor(sx0); x < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); x++) {
          n++;
          if (!isInk(x, y)) continue; // 背景と切れ端は透明。色は混ぜない
          const s = (y * img.width + x) * 4;
          const al = img.px[s + 3] / 255;
          r += img.px[s] * al;
          g += img.px[s + 1] * al;
          b += img.px[s + 2] * al;
          a += al;
        }
      }
      if (n === 0 || a === 0) continue;

      const px2 = ox + dx;
      const py2 = oy + dy;
      if (px2 < 0 || py2 < 0 || px2 >= tile || py2 >= tile) continue; // 枠からはみ出した光は切る
      const d = (py2 * tile + px2) * 4;
      out[d] = Math.round(r / a);
      out[d + 1] = Math.round(g / a);
      out[d + 2] = Math.round(b / a);
      out[d + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** 左右を反転した1コマを作る */
function mirrorCell(px, tile) {
  const out = new Uint8Array(px.length);
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      const s = (y * tile + x) * 4;
      const d = (y * tile + (tile - 1 - x)) * 4;
      out[d] = px[s];
      out[d + 1] = px[s + 1];
      out[d + 2] = px[s + 2];
      out[d + 3] = px[s + 3];
    }
  }
  return out;
}

function sheetFrom(cells, tile, cols, rows) {
  const W = cols * tile;
  const H = rows * tile;
  const out = new Uint8Array(W * H * 4);
  cells.forEach(({ row, col, px }) => {
    if (!px) return;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const s = (y * tile + x) * 4;
        if (px[s + 3] === 0) continue;
        const d = ((row * tile + y) * W + (col * tile + x)) * 4;
        out[d] = px[s];
        out[d + 1] = px[s + 1];
        out[d + 2] = px[s + 2];
        out[d + 3] = px[s + 3];
      }
    }
  });
  return { W, H, out };
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
  const bg = findBackground(img);
  console.log(`元絵: ${src}`);
  console.log(`大きさ: ${img.width}x${img.height}`);

  const all = rowBands(img, bg);
  const big = all.filter((b) => b.to - b.from + 1 >= 70);
  const small = all.filter((b) => {
    const h = b.to - b.from + 1;
    return h >= 24 && h < 70;
  });

  console.log(`大きい段 ${big.length} / 小さい段 ${small.length}`);
  for (const b of big) console.log(`  大 y=${b.from}..${b.to}`);
  for (const b of small) console.log(`  小 y=${b.from}..${b.to}`);

  if (big.length !== JOBS.length || small.length !== JOBS.length) {
    console.log(`※ ${JOBS.length} 段ずつ見つからない。元絵の余白を見直す`);
    process.exitCode = 1;
    return;
  }

  /*
   * 列の切れ目は小さい段から決める。
   * 大きい段はエフェクトが隣へはみ出して塊が繋がるので当てにならない。
   */
  const centres = [];
  for (let i = 0; i < POSES; i++) {
    const xs = small.map((b) => columnCenters(img, bg, b)[i]).filter((v) => v !== undefined);
    if (xs.length === 0) break;
    centres.push(xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  if (centres.length !== POSES) {
    console.log(`※ ポーズが ${centres.length} 列しか取れない（${POSES} 列のはず）`);
    process.exitCode = 1;
    return;
  }
  const edges = [LABEL_W];
  for (let i = 1; i < POSES; i++) edges.push(Math.round((centres[i - 1] + centres[i]) / 2));
  edges.push(img.width - 1);
  console.log(`列の切れ目: ${edges.join(' ')}`);

  const write = process.argv.includes('--write');
  const portraits = [];
  const boards = [];

  /**
   * その段の倍率を決める。
   *
   * **一番背の高いコマに合わせる。** 幅ではなく高さで決めるのは、
   * 斬撃や光が横に広がるコマがあるため。幅で決めると、
   * エフェクトの大きいコマだけキャラが小さくなる。
   * はみ出した光は枠で切れるが、キャラの大きさが揃うほうが大事。
   */
  const scaleFor = (band, tile, pad) => {
    let tallest = 1;
    for (let col = 0; col < POSES; col++) {
      const c = extractCell(img, bg, edges[col], edges[col + 1], band.from, band.to);
      if (c) tallest = Math.max(tallest, c.box.y1 - c.box.y0 + 1);
    }
    return (tile - pad * 2) / tallest;
  };

  JOBS.forEach((job, row) => {
    const pScale = scaleFor(big[row], PORTRAIT_TILE, 4);
    const sScale = scaleFor(small[row], BOARD_TILE, 0);
    let got = 0;
    for (let col = 0; col < POSES; col++) {
      const x0 = edges[col];
      const x1 = edges[col + 1];
      const pc = extractCell(img, bg, x0, x1, big[row].from, big[row].to);
      const sc = extractCell(img, bg, x0, x1, small[row].from, small[row].to);
      if (pc) {
        portraits.push({
          row,
          col,
          px: resampleInto(img, pc.isInk, pc.box, PORTRAIT_TILE, 4, pScale),
        });
        got++;
      }
      if (sc) {
        /*
         * 盤の上の姿は**左右の向きが要る。**
         * 絵は右を向いて描かれている（斬撃も踏み込みも右へ出る）ので、
         * 反転した一式を右半分に足しておく。
         *
         * CSS の transform で裏返す手もあるが、拡縮や移動の
         * アニメーションが同じ transform を使っていて喧嘩する。
         * **絵を2通り持つほうが、動きの仕組みを壊さない。**
         */
        const cell = resampleInto(img, sc.isInk, sc.box, BOARD_TILE, 0, sScale);
        boards.push({ row, col, px: cell });
        boards.push({ row, col: col + POSES, px: mirrorCell(cell, BOARD_TILE) });
      }
    }
    console.log(`${job}: ${got} ポーズ`);
  });

  if (!write) {
    console.log('\n下見だけ。書き出すなら -- --write');
    return;
  }

  const dir = resolve(here, '../public/sprites');
  mkdirSync(dir, { recursive: true });

  const p = sheetFrom(portraits, PORTRAIT_TILE, POSES, JOBS.length);
  writeFileSync(resolve(dir, 'portraits.png'), encodePng(p.W, p.H, p.out));
  console.log(`portraits.png （${p.W}x${p.H}）`);

  const b = sheetFrom(boards, BOARD_TILE, POSES * 2, JOBS.length);
  writeFileSync(resolve(dir, 'jobs.png'), encodePng(b.W, b.H, b.out));
  console.log(`jobs.png （${b.W}x${b.H}）`);
}

main();
