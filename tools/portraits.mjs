/**
 * ホーム画面の立ち絵（128x128）を組み立てる。
 *
 * ## なぜ文字絵で描かないか
 *
 * 盤の上のドット絵（16x16）は 1文字=1ピクセルで直に書いている。
 * あの書き方は小さいから成り立つ。128x128 は 64 倍の面積で、
 * **1職業あたり 16384 文字**になる。手で書くと直すたびに破綻する。
 *
 * なので立ち絵は**図形で組み立てる。**
 *   1. 丸・四角・多角形・手足（先細りのカプセル）で形を置く
 *   2. 左上から光を当てて、1色を 明・中・暗 の3段に割る
 *   3. 輪郭を、隣の色の一番暗い段で囲む（真っ黒で囲むと貼り絵に見える）
 *
 * ## 作りで気をつけたこと
 *
 * **左右対称にしない。** 最初は片側だけ描いて反転していたら、
 * どの職業も同じ箱に見えた。重心を片足に乗せ、腕の高さを変えるだけで
 * 「立っている人」になる。
 *
 * **顔は帽子より後に描く。** 先に描くと隠れてのっぺらぼうになる。
 *
 * ## 盤の絵との関係
 *
 * 形は 16x16 の職業スプライト（make-sprites.mjs の ART）を踏襲する。
 *   戦士     赤い前立ての兜・灰の板金・丸盾・剣
 *   盗賊     目だけ出た頭巾・暗い緑の外套・短剣
 *   魔法使い とんがり帽・紫のローブ・白ひげ・杖
 *   僧侶     光の輪・白い法衣・金の十字
 * ここを変えるときは盤の絵も一緒に直すこと。別人に見える。
 */

export const PORTRAIT_SIZE = 128;
/** 1職業あたりのコマ数。待機（呼吸）の2コマ */
export const PORTRAIT_FRAMES = 2;
export const PORTRAIT_JOBS = ['warrior', 'rogue', 'mage', 'cleric'];

const S = PORTRAIT_SIZE;

/* ── 色の家族 ──────────────────────────────────────────
 *
 * 1つの素材につき 明・中・暗・輪郭 の4段を持つ。
 * 描くときは中（base）だけで塗り、明暗は光の計算に任せる。
 * 手で影を描くと、形を直したときに影だけ取り残される。
 */
const FAMILIES = [
  { base: 'L', hi: 'h', sh: 'G', dk: 'J' }, // 鋼
  { base: 'S', hi: 'e', sh: 's', dk: 'u' }, // 肌
  { base: 'R', hi: 'f', sh: 'r', dk: 'v' }, // 赤
  { base: 'n', hi: 'm', sh: 'q', dk: 'x' }, // 緑
  { base: 'P', hi: 'i', sh: 'p', dk: 'z' }, // 紫
  { base: 'w', hi: 'W', sh: 'V', dk: 'A' }, // 白布
  { base: 'y', hi: 'Y', sh: 'T', dk: 'C' }, // 金
  { base: 't', hi: 'o', sh: 'X', dk: 'Z' }, // 革
  { base: 'D', hi: 'G', sh: 'K', dk: 'K' }, // 黒い布・靴
];

const BY_BASE = new Map(FAMILIES.map((f) => [f.base, f]));
/** どの段の色からでも家族を引けるようにしておく */
const FAMILY_OF = new Map();
for (const f of FAMILIES) for (const ch of [f.base, f.hi, f.sh, f.dk]) FAMILY_OF.set(ch, f);

/* ── 下敷き ────────────────────────────────────────── */

function canvas() {
  return new Array(S * S).fill('.');
}

function set(c, x, y, ch) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  c[y * S + x] = ch;
}

function get(c, x, y) {
  if (x < 0 || y < 0 || x >= S || y >= S) return '.';
  return c[y * S + x];
}

function rect(c, x, y, w, h, ch) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(c, x + i, y + j, ch);
}

function ell(c, cx, cy, rx, ry, ch) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(c, x, y, ch);
    }
  }
}

/** 多角形。走査線で塗る。外套・裾・肩布のような斜めの形に使う */
function poly(c, pts, ch) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by) continue;
      if (y >= Math.min(ay, by) && y < Math.max(ay, by)) {
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) set(c, x, y, ch);
    }
  }
}

/**
 * 手足。先細りのカプセル。
 *
 * 腕や脚を四角で描くと関節で折れず、板に見える。
 * 始点から終点へ丸を並べて太さを変えるだけで、生き物の手足になる。
 */
function limb(c, x1, y1, x2, y2, w1, w2, ch) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const r = (w1 + (w2 - w1) * k) / 2;
    ell(c, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, r, r, ch);
  }
}

/* ── 光と輪郭 ──────────────────────────────────────── */

/** そこが「この素材の外」か。別の素材との境にも陰影を付けたいので色で見る */
function otherThan(c, x, y, fam) {
  const ch = get(c, x, y);
  if (ch === '.') return true;
  return FAMILY_OF.get(ch) !== fam;
}

/**
 * 左上から光を当てる。
 *
 * その素材の外が左上すぐ近くにあれば明るい段、
 * 右下すぐ近くにあれば暗い段、それ以外は中のまま。
 * 面の向きを計算しない安い手だが、ドット絵の陰影はもともとこう付ける。
 */
function applyLight(c) {
  const src = c.slice();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ch = src[y * S + x];
      const fam = BY_BASE.get(ch);
      if (!fam) continue; // base で塗っていないところは触らない

      const lit =
        otherThan(src, x - 2, y - 2, fam) ||
        otherThan(src, x - 3, y - 1, fam) ||
        otherThan(src, x - 1, y - 3, fam);
      const dark =
        otherThan(src, x + 2, y + 2, fam) ||
        otherThan(src, x + 3, y + 1, fam) ||
        otherThan(src, x + 1, y + 3, fam);

      if (lit && !dark) set(c, x, y, fam.hi);
      else if (dark && !lit) set(c, x, y, fam.sh);
    }
  }
}

/**
 * 輪郭。**真っ黒では囲まない。**
 *
 * 全部を K で囲むと、切り抜いた紙を貼ったように見える。
 * 隣にある素材の一番暗い段で囲むと、絵の中に収まる。
 */
function outline(c) {
  const src = c.slice();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (src[y * S + x] !== '.') continue;
      let fam = null;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = get(src, x + dx, y + dy);
        if (n === '.') continue;
        const f = FAMILY_OF.get(n);
        if (f) {
          fam = f;
          break;
        }
      }
      if (fam) set(c, x, y, fam.dk);
    }
  }
}

/* ── 共通の体 ───────────────────────────────────────── */

/**
 * 素体。服はこの上に描く。
 *
 * 重心は向かって左足に乗せ、右足は半歩ひらく。
 * 左右を揃えると「気をつけ」になって人形に見える。
 *
 * t は呼吸ぶんの沈み込み。足は動かさない。
 */
function body(c, t, opt = {}) {
  const cloth = opt.cloth ?? 'D';
  const torso = opt.torso ?? 'L';
  const sleeve = opt.sleeve ?? torso;

  // 脚。向かって左が軸足（まっすぐ）、右は開いて軽く曲げる
  limb(c, 57, 78, 54, 112, 17, 13, cloth);
  limb(c, 72, 78, 79, 110, 17, 13, cloth);

  // 靴
  rect(c, 44, 113, 19, 9, 'D');
  ell(c, 54, 113, 10, 8, 'D');
  rect(c, 72, 111, 19, 9, 'D');
  ell(c, 79, 111, 10, 8, 'D');

  // 腰
  poly(c, [
    [52, 68 + t],
    [79, 68 + t],
    [81, 84 + t],
    [50, 84 + t],
  ], cloth);

  // 胴。肩を広く、腰を絞る
  poly(c, [
    [47, 40 + t],
    [84, 40 + t],
    [79, 72 + t],
    [52, 72 + t],
  ], torso);
  ell(c, 49, 44 + t, 9, 8, torso);
  ell(c, 82, 44 + t, 9, 8, torso);

  // 腕。左右で高さを変える。揃えると直立不動になる
  limb(c, 47, 45 + t, 41, 72 + t, 13, 10, sleeve);
  limb(c, 84, 45 + t, 91, 69 + t, 13, 10, sleeve);
  ell(c, 40, 77 + t, 7, 7, 'S');
  ell(c, 92, 74 + t, 7, 7, 'S');

  // 首と頭
  rect(c, 59, 32 + t, 13, 11, 'S');
  ell(c, 65, 22 + t, 16, 17, 'S');
}

/**
 * 顔。**帽子を描いたあとに呼ぶこと。**
 * 少し向かって右を向いているので、奥の目を1ドット小さくする。
 */
function face(c, t, y, opt = {}) {
  if (opt.dark) {
    /*
     * 頭巾の影の中。目だけ光らせる。
     * 暗がりに光る目は、顔を描き込まずに「人がいる」と分からせる一番安い手。
     */
    rect(c, 57, y + t, 6, 4, 'Y');
    rect(c, 68, y + t, 7, 4, 'Y');
    rect(c, 58, y + t + 1, 4, 2, 'f');
    rect(c, 69, y + t + 1, 5, 2, 'f');
    return;
  }
  // 奥（向かって左）の目を一回り小さくすると、わずかに横を向いて見える
  rect(c, 57, y + t, 5, 6, 'K');
  rect(c, 68, y + t, 6, 6, 'K');
  rect(c, 58, y + t + 1, 2, 3, 'W');
  rect(c, 69, y + t + 1, 3, 3, 'W');
  // 鼻と口。無いと顔が平らに見える
  rect(c, 65, y + t + 6, 3, 2, 's');
  rect(c, 61, y + t + 10, 8, 2, 'u');
}

/**
 * 帽子や兜で覆ったあとに、顔の出るところを肌で抜き直す。
 *
 * **これを忘れると のっぺらぼうになる。**
 * 先に顔を描いて上から兜をかぶせていたら、全員の顔が消えていた。
 */
function faceHole(c, t, cy, rx, ry) {
  ell(c, 66, cy + t, rx, ry, 'S');
}

/* ── 職業ごと ──────────────────────────────────────── */

function warrior(c, t) {
  body(c, t, { torso: 'L', cloth: 'D' });

  // 陣羽織。板金一色だと のっぺりする
  poly(c, [
    [59, 44 + t],
    [72, 44 + t],
    [74, 94 + t],
    [57, 94 + t],
  ], 'R');
  rect(c, 50, 68 + t, 31, 7, 't'); // 帯
  rect(c, 61, 67 + t, 10, 9, 'y');

  // 肩当て。板金の職業と一目で分かる出っぱり
  ell(c, 46, 42 + t, 13, 10, 'L');
  ell(c, 85, 42 + t, 13, 10, 'L');

  // 兜。まず全部かぶせて、あとから顔の出るところを抜く
  ell(c, 65, 20 + t, 19, 19, 'L');
  rect(c, 47, 20 + t, 37, 7, 'L');
  faceHole(c, t, 30, 13, 11);
  rect(c, 47, 17 + t, 37, 5, 'G'); // 目庇の影
  rect(c, 48, 26 + t, 7, 15, 'L'); // 頬当て
  rect(c, 77, 26 + t, 7, 15, 'L');
  poly(c, [
    [61, -4 + t],
    [70, -4 + t],
    [73, 10 + t],
    [58, 10 + t],
  ], 'R'); // 前立て
  face(c, t, 26);

  // 左腕の丸盾
  ell(c, 33, 66 + t, 17, 19, 'L');
  ell(c, 33, 66 + t, 12, 14, 'R');
  ell(c, 33, 66 + t, 5, 6, 'y');

  // 右手の剣。切っ先を床に付けて立てる
  rect(c, 89, 69 + t, 7, 10, 't');
  rect(c, 83, 78 + t, 19, 5, 'y');
  poly(c, [
    [88, 83 + t],
    [97, 83 + t],
    [93, 123],
  ], 'L');
}

function rogue(c, t) {
  body(c, t, { torso: 't', sleeve: 'n', cloth: 'D' });

  // 外套。片方の肩から斜めに掛ける。左右で形を変えると動きが出る
  poly(c, [
    [45, 40 + t],
    [86, 40 + t],
    [96, 96 + t],
    [79, 100 + t],
    [73, 68 + t],
    [40, 88 + t],
  ], 'n');
  ell(c, 65, 40 + t, 22, 8, 'n'); // 襟

  rect(c, 54, 50 + t, 23, 19, 't'); // 革の胸当て
  rect(c, 50, 68 + t, 31, 7, 't');
  rect(c, 61, 67 + t, 10, 9, 'y');

  // 頭巾。中は暗く落として、目だけ光らせる
  ell(c, 65, 21 + t, 20, 20, 'n');
  poly(c, [
    [66, -6 + t],
    [86, 16 + t],
    [46, 16 + t],
  ], 'n');
  ell(c, 66, 29 + t, 14, 12, 'x'); // 影の中の顔
  face(c, t, 25, { dark: true });
  rect(c, 54, 34 + t, 25, 11, 'n'); // 口元の布

  // 右手の短剣。下向きに構える
  rect(c, 89, 69 + t, 6, 12, 't');
  rect(c, 84, 80 + t, 16, 4, 'y');
  poly(c, [
    [88, 84 + t],
    [97, 84 + t],
    [92, 107 + t],
  ], 'L');
}

function mage(c, t) {
  body(c, t, { torso: 'P', cloth: 'P' });

  // ローブ。裾を床まで広げる。足を隠すと「歩かない人」になる
  poly(c, [
    [49, 44 + t],
    [82, 44 + t],
    [99, 123],
    [31, 123],
  ], 'P');
  // ひだ。縦の線を2本入れるだけで布に見える
  poly(c, [[56, 80 + t], [59, 80 + t], [51, 123], [46, 123]], 'p');
  poly(c, [[74, 80 + t], [77, 80 + t], [85, 123], [80, 123]], 'p');
  limb(c, 47, 45 + t, 39, 76 + t, 16, 13, 'P');
  limb(c, 84, 45 + t, 92, 71 + t, 16, 13, 'P');
  ell(c, 38, 80 + t, 7, 7, 'S');
  ell(c, 93, 75 + t, 7, 7, 'S');

  ell(c, 65, 46 + t, 6, 6, 'y'); // 首飾り

  // とんがり帽。つばの下に顔を出す
  poly(c, [
    [57, -10 + t],
    [86, 20 + t],
    [44, 20 + t],
  ], 'P');
  ell(c, 65, 21 + t, 26, 6, 'P');
  faceHole(c, t, 33, 13, 12);
  rect(c, 39, 24 + t, 52, 4, 'p'); // つばの影
  face(c, t, 29);
  // 白ひげ。顎から胸まで。魔法使いだと一目で分かる形
  poly(c, [
    [54, 42 + t],
    [78, 42 + t],
    [72, 64 + t],
    [60, 64 + t],
  ], 'w');

  // 左手の杖。背より高くして「魔法使い」を立たせる
  rect(c, 34, 16 + t, 7, 101 - t, 't');
  ell(c, 37, 12 + t, 11, 12, 'y');
  ell(c, 37, 12 + t, 5, 6, 'f');
}

function cleric(c, t) {
  body(c, t, { torso: 'w', cloth: 'w' });

  // 法衣
  poly(c, [
    [49, 44 + t],
    [82, 44 + t],
    [95, 123],
    [35, 123],
  ], 'w');
  poly(c, [[57, 82 + t], [60, 82 + t], [53, 123], [48, 123]], 'V');
  poly(c, [[73, 82 + t], [76, 82 + t], [82, 123], [77, 123]], 'V');
  limb(c, 47, 45 + t, 40, 74 + t, 15, 12, 'w');
  limb(c, 84, 45 + t, 91, 70 + t, 15, 12, 'w');
  ell(c, 39, 78 + t, 7, 7, 'S');
  ell(c, 92, 74 + t, 7, 7, 'S');

  // 金の縁取り。白一色だと洗濯物に見える
  rect(c, 49, 44 + t, 34, 4, 'y');
  poly(c, [[58, 48 + t], [61, 48 + t], [51, 123], [46, 123]], 'y');
  poly(c, [[70, 48 + t], [73, 48 + t], [81, 123], [76, 123]], 'y');
  rect(c, 50, 68 + t, 31, 6, 'y');

  // 胸の十字
  rect(c, 62, 52 + t, 8, 20, 'y');
  rect(c, 55, 57 + t, 22, 8, 'y');

  // 頭巾
  ell(c, 65, 21 + t, 20, 20, 'w');
  faceHole(c, t, 28, 14, 13);
  face(c, t, 24);
  // 光の輪。頭の上に浮かせる
  ell(c, 65, 0 + t, 17, 6, 'y');
  ell(c, 65, 0 + t, 12, 3, '.');
}

const PAINT = { warrior, rogue, mage, cleric };

/* ── 仕上げ ────────────────────────────────────────── */

/**
 * 1コマ描く。
 * frame 0 が基本、1 が息を吸ったところ（腰から上が 1 ドット沈む）。
 */
export function drawPortrait(job, frame) {
  const paint = PAINT[job];
  if (!paint) throw new Error(`立ち絵が無い: ${job}`);

  const c = canvas();
  paint(c, frame === 0 ? 0 : 1);
  applyLight(c);
  outline(c);

  const out = [];
  for (let y = 0; y < S; y++) out.push(c.slice(y * S, y * S + S).join(''));
  return out;
}
