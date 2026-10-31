/**
 * 仮スプライトシートを作る。  npm run sprites
 *
 * 絵を文字で書いて PNG にする。外部ライブラリを使わない。
 *
 * これは「仮」。0x72 DungeonTileset II（CC0, 16x16）などの本物の素材を
 * public/sprites/tiles.png に置けば、そのまま差し替わる。
 * 並び順は src/shared/sprites.ts の SPRITE_INDEX に合わせること。
 *
 * 絵を直したいときは下の ART を書き換えて npm run sprites。
 * 1文字 = 1ピクセル。'.' は透明。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 16;
const COLS = 6;

const PALETTE = {
  '.': null, // 透明
  K: '#12141a', // 輪郭
  D: '#2a2e35', // 暗い灰
  G: '#4a5160', // 灰
  L: '#8b93a3', // 明るい灰
  W: '#e8e8e8', // 白
  S: '#e8c9a0', // 肌
  R: '#c4564c', // 赤
  O: '#e08a3c', // 橙
  o: '#8a5a30', // 茶
  Y: '#e8c84a', // 黄
  N: '#4fae7a', // 緑
  n: '#2f7a52', // 暗い緑
  P: '#7a5ca8', // 紫
  B: '#4a7fb5', // 青
  // 「明るい＝歩ける」に統一する。
  // 壁を床より明るくすると、初見が明るいところを道だと思って押してしまう。
  1: '#2b3340', // 床（盤面で一番明るい）
  2: '#343d4c', // 床の模様
  3: '#13161b', // 目地
  4: '#222730', // レンガ（床より暗い）
};

/** 並び順 = src/shared/sprites.ts の SPRITE_INDEX */
const ART = [
  // 0 floor
  [
    '1111111111111111', '1111121111111111', '1111111111112111', '1211111111111111',
    '1111111121111111', '1111111111111111', '1111211111111111', '1111111111121111',
    '1111111111111111', '1121111111111111', '1111111111111111', '1111112111111111',
    '1111111111111121', '1111111111111111', '1112111111111111', '1111111111111111',
  ],
  // 1 wall
  [
    '3333333333333333', '3444443444444443', '3444443444444443', '3444443444444443',
    '3333333333333333', '3444444444344443', '3444444444344443', '3444444444344443',
    '3333333333333333', '3444443444444443', '3444443444444443', '3444443444444443',
    '3333333333333333', '3444444444344443', '3444444444344443', '3333333333333333',
  ],
  // 2 stairs
  [
    '1111111111111111', '1333333333333331', '13LLLLLLLLLLLL31', '13L3333333333L31',
    '13L3GGGGGGGG3L31', '13L3G333333G3L31', '13L3G3LLLL3G3L31', '13L3G3LKKL3G3L31',
    '13L3G3LKKL3G3L31', '13L3G3LLLL3G3L31', '13L3G333333G3L31', '13L3GGGGGGGG3L31',
    '13L3333333333L31', '13LLLLLLLLLLLL31', '1333333333333331', '1111111111111111',
  ],
  // 3 hero
  [
    '................', '.....KKKKKK.....', '....KLLLLLLK....', '....KLWWWWLK....',
    '....KLWSSWLK....', '....KLSSSSLK....', '.....KSSSSK.....', '....KKBBBBKK....',
    '...KBBBBBBBBK...', '...KBBWBBWBBK...', '...KBBBBBBBBK...', '....KBBBBBBK....',
    '....KDD..DDK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  // 4 goblin
  [
    '................', '................', '....KKKKKKKK....', '...KNNNNNNNNK...',
    '..KNNNNNNNNNNK..', '..KNnNNNNNNnNK..', '..KNNWNNNNWNNK..', '..KNNWKNNKWNNK..',
    '..KNNNNNNNNNNK..', '..KNNKKKKKKNNK..', '...KNNNNNNNNK...', '....KNNNNNNK....',
    '....KDDNNDDK....', '.....KDK.KDK....', '................', '................',
  ],
  // 5 bat
  [
    '................', '................', '..K..........K..', '..KK........KK..',
    '..KPK......KPK..', '..KPPK....KPPK..', '.KPPPPK..KPPPPK.', '.KPPPPPKKPPPPPK.',
    '.KPPPKKPPKKPPPK.', '..KPK.KPPK.KPK..', '...K..KWWK..K...', '......KPPK......',
    '.......KK.......', '................', '................', '................',
  ],
  // 6 slime
  [
    '................', '................', '................', '......KKKK......',
    '....KKNNNNKK....', '...KNNNNNNNNK...', '..KNNNNNNNNNNK..', '..KNNWNNNNWNNK..',
    '.KNNNNNNNNNNNNK.', '.KNNNNNNNNNNNNK.', '.KnNNNNNNNNNNnK.', '.KnnNNNNNNNNnnK.',
    '.KnnnnnnnnnnnnK.', '..KKKKKKKKKKKK..', '................', '................',
  ],
  // 7 potion
  [
    '................', '......KKKK......', '......KLLK......', '......KLLK......',
    '.....KKLLKK.....', '.....KLLLLK.....', '....KLLLLLLK....', '...KLLWLLLLLK...',
    '...KLRRRRRRLK...', '..KLRRRRRRRRLK..', '..KLRRRRRRRRLK..', '..KLRRRRRRRRLK..',
    '..KLRRRRRRRRLK..', '...KLRRRRRRLK...', '....KKKKKKKK....', '................',
  ],
  // 8 bomb
  [
    '................', '............KG..', '...........KGK..', '..........KGK...',
    '.........KOK....', '.......KKKK.....', '.....KKDDDDKK...', '....KDDDDDDDDK..',
    '...KDDLDDDDDDDK.', '...KDLDDDDDDDDK.', '...KDDDDDDDDDDK.', '...KDDDDDDDDDDK.',
    '....KDDDDDDDDK..', '.....KKDDDDKK...', '.......KKKK.....', '................',
  ],
  // 9 sword
  [
    '.......KK.......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '...KKKKLWKKKK...', '...KGGGGGGGGK...', '...KKKKooKKKK...',
    '......KooK......', '......KooK......', '......KKKK......', '................',
  ],
  // 10 shield
  [
    '................', '..KKKKKKKKKKKK..', '..KLLLLLLLLLLK..', '..KLBBBBBBBBLK..',
    '..KLBBBYYBBBLK..', '..KLBBYYYYBBLK..', '..KLBYYYYYYBLK..', '..KLBBYYYYBBLK..',
    '..KLBBBYYBBBLK..', '..KLBBBBBBBBLK..', '..KLBBBBBBBBLK..', '...KLBBBBBBLK...',
    '....KLBBBBLK....', '.....KLBBLK.....', '......KLLK......', '.......KK.......',
  ],
  // 11 scroll
  [
    '................', '................', '..KGGGGGGGGGGK..', '..KGWWWWWWWWGK..',
    '..KWWWWWWWWWWK..', '..KWKKKKKKKKWK..', '..KWWWWWWWWWWK..', '..KWKKKKKKKWWK..',
    '..KWWWWWWWWWWK..', '..KWKKKKKKKKWK..', '..KWWWWWWWWWWK..', '..KWKKKKKKWWWK..',
    '..KGWWWWWWWWGK..', '..KGGGGGGGGGGK..', '................', '................',
  ],
];

// --- ここから下は PNG を書き出すだけ ---

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

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
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(width, height, pixels /* RGBA Uint8Array */) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // フィルタなし
    pixels.subarray(y * width * 4, (y + 1) * width * 4)
      .forEach((v, i) => { raw[y * (width * 4 + 1) + 1 + i] = v; });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rows = Math.ceil(ART.length / COLS);
const W = COLS * TILE;
const H = rows * TILE;
const px = new Uint8Array(W * H * 4);

ART.forEach((art, index) => {
  if (art.length !== TILE) throw new Error(`スプライト ${index}: ${art.length} 行（${TILE} 行であること）`);
  const ox = (index % COLS) * TILE;
  const oy = Math.floor(index / COLS) * TILE;

  art.forEach((line, y) => {
    if (line.length !== TILE) {
      throw new Error(`スプライト ${index} の ${y + 1} 行目: ${line.length} 文字（${TILE} 文字であること）`);
    }
    [...line].forEach((ch, x) => {
      if (!(ch in PALETTE)) throw new Error(`スプライト ${index}: 未定義の文字 '${ch}'`);
      const hex = PALETTE[ch];
      if (hex === null) return; // 透明
      const [r, g, b] = rgb(hex);
      const i = ((oy + y) * W + (ox + x)) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    });
  });
});

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sprites/tiles.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toPng(W, H, px));
console.log(`${out} に書き出した（${W}x${H}, ${ART.length} 枚）`);
