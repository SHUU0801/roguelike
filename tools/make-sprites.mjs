/**
 * スプライトシートを作る。  npm run sprites
 *
 * 絵を文字で書いて PNG にする。外部ライブラリを使わない。
 * 1文字 = 1ピクセル。'.' は透明。
 *
 * 生き物は2コマ。LAYOUT で隣り合わせに並べてあり、CSS 側が
 * background-position-x を steps() で切り替えてパラパラ動かす。
 *
 * 本物の素材（0x72 DungeonTileset II など、CC0, 16x16）に差し替えるときは、
 * LAYOUT と同じ並び順の PNG を public/sprites/tiles.png に置けばいい。
 * 並び順は src/shared/sprites.ts の SPRITE_INDEX と必ず一致させること。
 */
import { deflateSync } from 'node:zlib';
import {
  PORTRAIT_FRAMES,
  PORTRAIT_JOBS,
  PORTRAIT_SIZE,
  drawPortrait,
} from './portraits.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * 床タイルの右端と下端は1段明るい色にしてある（継ぎ目）。
 *
 * 盤のマスの隙間（CSS の gap）を 0 にして地面を繋げたら、
 * 今度はマスの境目が完全に消えて、距離が数えられなくなった。
 * 黒い溝ではなく**明るい継ぎ目**にすると、繋がったまま目盛りになる。
 */
const TILE = 16;
const COLS = 9;

/**
 * シート上の並び。2コマあるものは <名前> と <名前>_b が **隣り合う**こと。
 * CSS は横位置を1枠ずらすだけでコマを切り替えるので、折り返しをまたぐと壊れる。
 */
const LAYOUT = [
  // 1行目: 1コマのもの
  'floor', 'wall', 'stairs', 'potion', 'bomb', 'sword', 'shield', 'scroll', 'torch',
  // 2行目: 2コマのもの（必ず対で置く）
  'hero', 'hero_b', 'goblin', 'goblin_b', 'bat', 'bat_b', 'slime', 'slime_b', 'blank',
  /*
   * 3〜4行目: 職業ごとの姿。1職業あたり4コマ。
   *   待機2コマ（呼吸） + 歩き2コマ（足を前後に出す）
   * コマ送りは background-position-x を横にずらすだけなので、
   * **4コマが折り返しをまたいではいけない。** だから1行に2職業。
   */
  'warrior', 'warrior_b', 'warrior_w1', 'warrior_w2',
  'rogue', 'rogue_b', 'rogue_w1', 'rogue_w2', 'blank',
  'mage', 'mage_b', 'mage_w1', 'mage_w2',
  'cleric', 'cleric_b', 'cleric_w1', 'cleric_w2', 'blank',
  // 5行目: ダンジョンごとの地形。見た目が変わらないと、どこへ潜っても同じ場所に見える
  'floor_cave', 'wall_cave', 'floor_ice', 'wall_ice', 'blank', 'blank', 'blank', 'blank', 'blank',
];

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

  /*
   * 立ち絵（128x128）用。素材ごとに 明・中・暗・輪郭 の4段を持つ。
   * 盤のドット絵は 16x16 で、1ドットに影を入れる余地が無いのでここだけ。
   * tools/portraits.mjs の FAMILIES と必ず対で直すこと。
   */
  h: '#a9b2c2', e: '#f3dcbb', f: '#e07a6e', m: '#4f9a6d', i: '#9a7ccb', // 明
  g: '#39404e', s: '#c49a70', r: '#8f3a33', q: '#1f5538', p: '#553d78', // 中〜暗
  u: '#8f6c4a', v: '#5a241f', x: '#143826', z: '#3a2a55',               // 輪郭
  w: '#c2c7d0', V: '#9aa2b0', U: '#6e7686',                             // 白布
  y: '#b8962e', T: '#8a6f1e', Q: '#5c4a12',                             // 金
  t: '#5c3c20', X: '#3d2816', Z: '#261806',                             // 革
  J: '#232833', A: '#4a5260', C: '#4a3a0e',                             // 濃い輪郭
  // 「明るい＝歩ける」に統一する。
  // 壁を床より明るくすると、初見が明るいところを道だと思って押してしまう。
  1: '#2b3340', // 床（盤面で一番明るい）
  2: '#343d4c', // 床の模様
  3: '#13161b', // 目地
  4: '#222730', // レンガ（床より暗い）

  // 洞窟。土と岩。レンガより丸く、ざらついた模様にする
  5: '#32302a', // 洞窟の床
  6: '#3b3831', // 洞窟の床の模様
  7: '#201e1a', // 洞窟の岩（床より暗い。明るい＝歩けるを守る）
  8: '#15130f', // 洞窟の岩の影

  // 氷窟。青白いが、やはり床のほうが明るい
  9: '#2f3d4a', // 氷の床
  a: '#3b4e5e', // 氷の床のひび
  b: '#1b2630', // 氷の壁
  c: '#101820', // 氷の壁の影
};

const ART = {
  floor: [
    '1111111111111112', '1111121111111112', '1111111111112112', '1211111111111112',
    '1111111121111112', '1111111111111112', '1111211111111112', '1111111111121112',
    '1111111111111112', '1121111111111112', '1111111111111112', '1111112111111112',
    '1111111111111122', '1111111111111112', '1112111111111112', '2222222222222222',
  ],
  wall: [
    '3333333333333333', '3444443444444443', '3444443444444443', '3444443444444443',
    '3333333333333333', '3444444444344443', '3444444444344443', '3444444444344443',
    '3333333333333333', '3444443444444443', '3444443444444443', '3444443444444443',
    '3333333333333333', '3444444444344443', '3444444444344443', '3333333333333333',
  ],
  stairs: [
    '1111111111111111', '1333333333333331', '13LLLLLLLLLLLL31', '13L3333333333L31',
    '13L3GGGGGGGG3L31', '13L3G333333G3L31', '13L3G3LLLL3G3L31', '13L3G3LKKL3G3L31',
    '13L3G3LKKL3G3L31', '13L3G3LLLL3G3L31', '13L3G333333G3L31', '13L3GGGGGGGG3L31',
    '13L3333333333L31', '13LLLLLLLLLLLL31', '1333333333333331', '1111111111111111',
  ],
  potion: [
    '................', '......KKKK......', '......KLLK......', '......KLLK......',
    '.....KKLLKK.....', '.....KLLLLK.....', '....KLLLLLLK....', '...KLLWLLLLLK...',
    '...KLRRRRRRLK...', '..KLRRRRRRRRLK..', '..KLRRRRRRRRLK..', '..KLRRRRRRRRLK..',
    '..KLRRRRRRRRLK..', '...KLRRRRRRLK...', '....KKKKKKKK....', '................',
  ],
  bomb: [
    '................', '............KG..', '...........KGK..', '..........KGK...',
    '.........KOK....', '.......KKKK.....', '.....KKDDDDKK...', '....KDDDDDDDDK..',
    '...KDDLDDDDDDDK.', '...KDLDDDDDDDDK.', '...KDDDDDDDDDDK.', '...KDDDDDDDDDDK.',
    '....KDDDDDDDDK..', '.....KKDDDDKK...', '.......KKKK.....', '................',
  ],
  sword: [
    '.......KK.......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '...KKKKLWKKKK...', '...KGGGGGGGGK...', '...KKKKooKKKK...',
    '......KooK......', '......KooK......', '......KKKK......', '................',
  ],
  shield: [
    '................', '..KKKKKKKKKKKK..', '..KLLLLLLLLLLK..', '..KLBBBBBBBBLK..',
    '..KLBBBYYBBBLK..', '..KLBBYYYYBBLK..', '..KLBYYYYYYBLK..', '..KLBBYYYYBBLK..',
    '..KLBBBYYBBBLK..', '..KLBBBBBBBBLK..', '..KLBBBBBBBBLK..', '...KLBBBBBBLK...',
    '....KLBBBBLK....', '.....KLBBLK.....', '......KLLK......', '.......KK.......',
  ],
  scroll: [
    '................', '................', '..KGGGGGGGGGGK..', '..KGWWWWWWWWGK..',
    '..KWWWWWWWWWWK..', '..KWKKKKKKKKWK..', '..KWWWWWWWWWWK..', '..KWKKKKKKKWWK..',
    '..KWWWWWWWWWWK..', '..KWKKKKKKKKWK..', '..KWWWWWWWWWWK..', '..KWKKKKKKWWWK..',
    '..KGWWWWWWWWGK..', '..KGGGGGGGGGGK..', '................', '................',
  ],

  torch: [
    '................', '.......OO.......', '......OYYO......', '.....OYYYYO.....',
    '.....OYWWYO.....', '.....OYYYYO.....', '......OYYO......', '.......OO.......',
    '.......oo.......', '.......oo.......', '.......oo.......', '.......oo.......',
    '.......oo.......', '.......oo.......', '.......oo.......', '................',
  ],
  // 枠を埋めるためだけの空。並びを崩さないために置いてある

  // --- 洞窟。岩は丸く、床は土 ---
  floor_cave: [
    '5555555555555556', '5556555555555556', '5555555555655556', '5655555555555556',
    '5555555565555556', '5555555555555556', '5555655555555556', '5555555555565556',
    '5555555555555556', '5565555555555556', '5555555555555556', '5555565555555556',
    '5555555555555656', '5555555555555556', '5556555555555556', '6666666666666666',
  ],
  wall_cave: [
    '8888888888888888', '8777777888777778', '8777777887777778', '8777777777777778',
    '8877777777777788', '8887777777777888', '8888777777778888', '8888877777888888',
    '8888887777888888', '8888877777788888', '8887777777777888', '8877777777777788',
    '8777777777777778', '8777778887777778', '8777788888777778', '8888888888888888',
  ],

  // --- 氷窟。床にひびを入れる ---
  floor_ice: [
    '999999999999999a', '999a99999999a99a', '99999999a999999a', '9a9999999999999a',
    '99999999a999999a', '999999999999999a', '9999a9999999999a', '99999999999a999a',
    '999999999999999a', '99a999999999999a', '999999999999999a', '999999a99999999a',
    '999999999999a99a', '999999999999999a', '999a99999999999a', 'aaaaaaaaaaaaaaaa',
  ],
  wall_ice: [
    'cccccccccccccccc', 'cbbbbbcbbbbbbbbc', 'cbbbbbcbbbbbbbbc', 'cbbbbbcbbbbbbbbc',
    'cccccccccccccccc', 'cbbbbbbbbbcbbbbc', 'cbbbbbbbbbcbbbbc', 'cbbbbbbbbbcbbbbc',
    'cccccccccccccccc', 'cbbbbbcbbbbbbbbc', 'cbbbbbcbbbbbbbbc', 'cbbbbbcbbbbbbbbc',
    'cccccccccccccccc', 'cbbbbbbbbbcbbbbc', 'cbbbbbbbbbcbbbbc', 'cccccccccccccccc',
  ],


  /*
   * 歩きのコマ。足を前後に出す。
   *
   * 待機コマ（_b）は全体を1ドット下げただけで、これは呼吸に見える。
   * **歩いて見せるには足が入れ替わる必要がある。**
   * 左足を出したコマと右足を出したコマを交互に出す。
   * 上半身は1ドット上下させて、重心の移動も付ける。
   */
  warrior_w1: [
    '................', '.......RR.......', '.....KKRRKK.....', '....KLLLLLLK....',
    '....KLKKKKLK....', '....KLSSSSLK....', '.....KSSSSK.....', '....KKGGGGKK....',
    '...KGGGGGGGGK...', '...KGLGGGGLGK...', '...KGGGGGGGGK...', '....KGGGGGGK....',
    '...KDDK..KDK....', '..KDDK....KDK...', '..KDK......KK...', '................',
  ],
  warrior_w2: [
    '................', '.......RR.......', '.....KKRRKK.....', '....KLLLLLLK....',
    '....KLKKKKLK....', '....KLSSSSLK....', '.....KSSSSK.....', '....KKGGGGKK....',
    '...KGGGGGGGGK...', '...KGLGGGGLGK...', '...KGGGGGGGGK...', '....KGGGGGGK....',
    '....KDK..KDDK...', '...KDK....KDDK..', '...KK......KDK..', '................',
  ],

  rogue_w1: [
    '................', '......KKKK......', '....KKnnnnKK....', '...KnnnnnnnnK...',
    '...KnnSSSSnnK...', '....KSKSSKSK....', '.....KSSSSK.....', '....KKnnnnKK....',
    '...KnnnnnnnnK...', '..KLKnnnnnnnK...', '..KWKnnYYnnnK...', '...K.KnnnnnnK...',
    '...KDDK..KDK....', '..KDDK....KDK...', '..KDK......KK...', '................',
  ],
  rogue_w2: [
    '................', '......KKKK......', '....KKnnnnKK....', '...KnnnnnnnnK...',
    '...KnnSSSSnnK...', '....KSKSSKSK....', '.....KSSSSK.....', '....KKnnnnKK....',
    '...KnnnnnnnnK...', '..KLKnnnnnnnK...', '..KWKnnYYnnnK...', '...K.KnnnnnnK...',
    '....KDK..KDDK...', '...KDK....KDDK..', '...KK......KDK..', '................',
  ],

  mage_w1: [
    '.......KK.......', '......KPPK......', '.....KPPPPK.....', '....KPPPPPPK....',
    '..KKKKKKKKKKKK..', '....KLSSSSLK....', '....KLSKKSLK....', '.....KSSSSK.....',
    '....KKPPPPKK....', '...KPPPPPPPPK...', '...KPPPYYPPPK...', '...KPPPPPPPPK...',
    '...KPPK..KPPK...', '..KDDK....KDK...', '..KDK......KK...', '................',
  ],
  mage_w2: [
    '.......KK.......', '......KPPK......', '.....KPPPPK.....', '....KPPPPPPK....',
    '..KKKKKKKKKKKK..', '....KLSSSSLK....', '....KLSKKSLK....', '.....KSSSSK.....',
    '....KKPPPPKK....', '...KPPPPPPPPK...', '...KPPPYYPPPK...', '...KPPPPPPPPK...',
    '...KPPK..KPPK...', '...KDK....KDDK..', '...KK......KDK..', '................',
  ],

  cleric_w1: [
    '.....YYYYYY.....', '.....KKKKKK.....', '....KLLLLLLK....', '....KLSSSSLK....',
    '....KLSKKSLK....', '.....KSSSSK.....', '....KKWWWWKK....', '...KWWWYYWWWK...',
    '...KWWWYYWWWK...', '...KWYYYYYYWK...', '...KWWWYYWWWK...', '....KWWYYWWK....',
    '...KWWK..KWWK...', '..KDDK....KDK...', '..KDK......KK...', '................',
  ],
  cleric_w2: [
    '.....YYYYYY.....', '.....KKKKKK.....', '....KLLLLLLK....', '....KLSSSSLK....',
    '....KLSKKSLK....', '.....KSSSSK.....', '....KKWWWWKK....', '...KWWWYYWWWK...',
    '...KWWWYYWWWK...', '...KWYYYYYYWK...', '...KWWWYYWWWK...', '....KWWYYWWK....',
    '...KWWK..KWWK...', '...KDK....KDDK..', '...KK......KDK..', '................',
  ],


  blank: [
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................', '................', '................', '................',
  ],

  // --- 生き物は2コマ。_b が2コマ目 ---

  hero: [
    '................', '.....KKKKKK.....', '....KLLLLLLK....', '....KLWWWWLK....',
    '....KLWSSWLK....', '....KLSSSSLK....', '.....KSSSSK.....', '....KKBBBBKK....',
    '...KBBBBBBBBK...', '...KBBWBBWBBK...', '...KBBBBBBBBK...', '....KBBBBBBK....',
    '....KDD..DDK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  // 全体を1ドット下げる。これだけで息をしているように見える
  hero_b: [
    '................', '................', '.....KKKKKK.....', '....KLLLLLLK....',
    '....KLWWWWLK....', '....KLWSSWLK....', '....KLSSSSLK....', '.....KSSSSK.....',
    '....KKBBBBKK....', '...KBBBBBBBBK...', '...KBBWBBWBBK...', '...KBBBBBBBBK...',
    '....KBBBBBBK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],

  goblin: [
    '................', '................', '....KKKKKKKK....', '...KNNNNNNNNK...',
    '..KNNNNNNNNNNK..', '..KNnNNNNNNnNK..', '..KNNWNNNNWNNK..', '..KNNWKNNKWNNK..',
    '..KNNNNNNNNNNK..', '..KNNKKKKKKNNK..', '...KNNNNNNNNK...', '....KNNNNNNK....',
    '....KDDNNDDK....', '.....KDK.KDK....', '................', '................',
  ],
  // まばたき
  goblin_b: [
    '................', '................', '....KKKKKKKK....', '...KNNNNNNNNK...',
    '..KNNNNNNNNNNK..', '..KNnNNNNNNnNK..', '..KNNnNNNNnNNK..', '..KNNNNNNNNNNK..',
    '..KNNNNNNNNNNK..', '..KNNKKKKKKNNK..', '...KNNNNNNNNK...', '....KNNNNNNK....',
    '....KDDNNDDK....', '.....KDK.KDK....', '................', '................',
  ],

  bat: [
    '................', '................', '..K..........K..', '..KK........KK..',
    '..KPK......KPK..', '..KPPK....KPPK..', '.KPPPPK..KPPPPK.', '.KPPPPPKKPPPPPK.',
    '.KPPPKKPPKKPPPK.', '..KPK.KPPK.KPK..', '...K..KWWK..K...', '......KPPK......',
    '.......KK.......', '................', '................', '................',
  ],
  // 羽を下ろす
  bat_b: [
    '................', '................', '................', '..KK........KK..',
    '..KPK......KPK..', '..KPPK....KPPK..', '..KPPPK..KPPPK..', '.KPPPPPKKPPPPPK.',
    '.KPPPKKPPKKPPPK.', '..KPK.KPPK.KPK..', '...K..KWWK..K...', '......KPPK......',
    '.......KK.......', '................', '................', '................',
  ],

  slime: [
    '................', '................', '................', '......KKKK......',
    '....KKNNNNKK....', '...KNNNNNNNNK...', '..KNNNNNNNNNNK..', '..KNNWNNNNWNNK..',
    '.KNNNNNNNNNNNNK.', '.KNNNNNNNNNNNNK.', '.KnNNNNNNNNNNnK.', '.KnnNNNNNNNNnnK.',
    '.KnnnnnnnnnnnnK.', '..KKKKKKKKKKKK..', '................', '................',
  ],
  // 潰れる
  slime_b: [
    '................', '................', '................', '................',
    '.....KKKKKK.....', '...KKNNNNNNKK...', '..KNNNNNNNNNNK..', '..KNNWNNNNWNNK..',
    '.KNNNNNNNNNNNNK.', '.KnNNNNNNNNNNnK.', '.KnnNNNNNNNNnnK.', '.KnnnnnnnnnnnnK.',
    '..KKKKKKKKKKKK..', '................', '................', '................',
  ],

  // --- 職業ごとの姿。番号だけでは「誰が盾役か」が盤上で分からない ---

  warrior: [
    '................', '.......RR.......', '.....KKRRKK.....', '....KLLLLLLK....',
    '....KLKKKKLK....', '....KLSSSSLK....', '.....KSSSSK.....', '....KKGGGGKK....',
    '...KGGGGGGGGK...', '...KGLGGGGLGK...', '...KGGGGGGGGK...', '....KGGGGGGK....',
    '....KDD..DDK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  warrior_b: [
    '................', '................', '.......RR.......', '.....KKRRKK.....',
    '....KLLLLLLK....', '....KLKKKKLK....', '....KLSSSSLK....', '.....KSSSSK.....',
    '....KKGGGGKK....', '...KGGGGGGGGK...', '...KGLGGGGLGK...', '...KGGGGGGGGK...',
    '....KGGGGGGK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],

  rogue: [
    '................', '......KKKK......', '....KKnnnnKK....', '...KnnnnnnnnK...',
    '...KnnSSSSnnK...', '....KSKSSKSK....', '.....KSSSSK.....', '....KKnnnnKK....',
    '...KnnnnnnnnK...', '..KLKnnnnnnnK...', '..KWKnnYYnnnK...', '...K.KnnnnnnK...',
    '....KDD..DDK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  rogue_b: [
    '................', '................', '......KKKK......', '....KKnnnnKK....',
    '...KnnnnnnnnK...', '...KnnSSSSnnK...', '....KSKSSKSK....', '.....KSSSSK.....',
    '....KKnnnnKK....', '...KnnnnnnnnK...', '..KLKnnnnnnnK...', '..KWKnnYYnnnK...',
    '...K.KnnnnnnK...', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],

  mage: [
    '.......KK.......', '......KPPK......', '.....KPPPPK.....', '....KPPPPPPK....',
    '..KKKKKKKKKKKK..', '....KLSSSSLK....', '....KLSKKSLK....', '.....KSSSSK.....',
    '....KKPPPPKK....', '...KPPPPPPPPK...', '...KPPPYYPPPK...', '...KPPPPPPPPK...',
    '....KPPPPPPK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  mage_b: [
    '................', '.......KK.......', '......KPPK......', '.....KPPPPK.....',
    '....KPPPPPPK....', '..KKKKKKKKKKKK..', '....KLSSSSLK....', '....KLSKKSLK....',
    '.....KSSSSK.....', '....KKPPPPKK....', '...KPPPPPPPPK...', '...KPPPYYPPPK...',
    '...KPPPPPPPPK...', '....KPPPPPPK....', '...KKDK..KDKK...', '................',
  ],

  cleric: [
    '.....YYYYYY.....', '.....KKKKKK.....', '....KLLLLLLK....', '....KLSSSSLK....',
    '....KLSKKSLK....', '.....KSSSSK.....', '....KKWWWWKK....', '...KWWWYYWWWK...',
    '...KWWWYYWWWK...', '...KWYYYYYYWK...', '...KWWWYYWWWK...', '....KWWYYWWK....',
    '....KWWWWWWK....', '....KDD..DDK....', '...KKDK..KDKK...', '................',
  ],
  cleric_b: [
    '................', '.....YYYYYY.....', '.....KKKKKK.....', '....KLLLLLLK....',
    '....KLSSSSLK....', '....KLSKKSLK....', '.....KSSSSK.....', '....KKWWWWKK....',
    '...KWWWYYWWWK...', '...KWWWYYWWWK...', '...KWYYYYYYWK...', '...KWWWYYWWWK...',
    '....KWWYYWWK....', '....KWWWWWWK....', '...KKDK..KDKK...', '................',
  ],
};



/**
 * UI のアイコン。盤面とは別のシートにする。
 *
 * 絵文字をやめた理由は見た目の統一だけではない。
 * 絵文字は端末ごとに絵が違う（iPhone と Android と Windows で別物）ので、
 * 「この印は何か」を説明に書けない。自分で描けば、どこで開いても同じ絵になる。
 *
 * 盤面のシートと分けているのは、盤は 16x16 のマスに縛られているが、
 * アイコンは増減が多く、並びを変えても盤に影響が出ないようにするため。
 */
const ICON_COLS = 8;

const ICON_LAYOUT = [
  'helmet', 'dagger', 'hat', 'cross', 'axe', 'horn', 'shield2', 'smoke',
  'flask', 'flame', 'bolt', 'ice', 'sparkle', 'note', 'hammer', 'heart',
  'sword2', 'torch2', 'wing', 'star', 'drop', 'burst', 'question', 'map',
  'sound', 'mute', 'lock', 'check', 'skull', 'cog', 'flee', 'blank',
];

const ICON_ART = {
  // --- 職業 ---
  // 兜。24px で出すので、穴は細く2つに分ける。
  // 横一直線の大きな穴にしたら、潰れてただの灰色の塊に見えた
  helmet: [
    '................', '.......RR.......', '......KRRK......', '.....KKRRKK.....',
    '...KKLLLLLLKK...', '..KLLLLLLLLLLK..', '..KLLLLLLLLLLK..', '..KLLKKKKKKLLK..',
    '..KLLK.KK.KLLK..', '..KLLK.KK.KLLK..', '..KLLKKKKKKLLK..', '..KLLLLLLLLLLK..',
    '..KGGGGGGGGGGK..', '..KGGGGGGGGGGK..', '...KKKKKKKKKK...', '................',
  ],
  dagger: [
    '...........KK...', '..........KWWK..', '.........KWWWK..', '........KWWWK...',
    '.......KWWWK....', '......KWWWK.....', '.....KWWWK......', '....KWWWK.......',
    '...KWWWK........', '..KKWWKKK.......', '..KoKKKoK.......', '..KoooooK.......',
    '...KooooK.......', '....KooK........', '....KooK........', '.....KK.........',
  ],
  hat: [
    '.......KK.......', '.......KPK......', '......KPPK......', '......KPPPK.....',
    '.....KPPPPK.....', '.....KPPPPPK....', '....KPPPPPPK....', '....KPPPPPPPK...',
    '...KPPPYYPPPK...', '...KPPPYYPPPK...', '..KPPPPPPPPPPK..', '.KPPPPPPPPPPPPK.',
    'KKKKKKKKKKKKKKKK', 'KLLLLLLLLLLLLLLK', 'KKKKKKKKKKKKKKKK', '................',
  ],
  cross: [
    '................', '......KYYK......', '......KYYK......', '......KYYK......',
    '..KKKKKYYKKKKK..', '..KYYYYYYYYYYK..', '..KYYYYYYYYYYK..', '..KKKKKYYKKKKK..',
    '......KYYK......', '......KYYK......', '......KYYK......', '......KYYK......',
    '......KYYK......', '......KKKK......', '................', '................',
  ],

  // --- 戦士のわざ ---
  axe: [
    '................', '...KKKK.........', '..KWWWWKK.......', '.KWWWWWWWK..KK..',
    '.KWWWWWWWWK.KoK.', '.KWWWWWWWWK.KoK.', '.KWWWWWWWWKKKoK.', '.KWWWWWWWWWWWoK.',
    '.KWWWWWWWWKKKoK.', '.KWWWWWWWWK.KoK.', '.KWWWWWWWK..KoK.', '..KWWWWKK...KoK.',
    '...KKKK.....KoK.', '............KoK.', '............KKK.', '................',
  ],
  horn: [
    '................', '................', '.....KKK........', '...KKOOOKK......',
    '..KOOOOOOOK.....', '..KOOOOOOOOK....', '..KOOOOOOOOOK.K.', '..KOOOOOOOOOOK..',
    '..KOOOOOOOOOK.K.', '..KOOOOOOOOK....', '..KOOOOOOOK.....', '...KKOOOKK......',
    '.....KKK........', '................', '................', '................',
  ],
  shield2: [
    '................', '.KKKKKKKKKKKKKK.', '.KLLLLLLLLLLLLK.', '.KLBBBBBBBBBBLK.',
    '.KLBBBBYYBBBBLK.', '.KLBBBYYYYBBBLK.', '.KLBBYYYYYYBBLK.', '.KLBBBYYYYBBBLK.',
    '.KLBBBBYYBBBBLK.', '.KLBBBBBBBBBBLK.', '..KLBBBBBBBBLK..', '...KLBBBBBBLK...',
    '....KLBBBBLK....', '.....KLBBLK.....', '......KLLK......', '.......KK.......',
  ],

  // --- 盗賊のわざ ---
  smoke: [
    '................', '....KKK...KK....', '..KKLLLKKKLLK...', '.KLLLLLLLLLLLK..',
    'KLLLLLLLLLLLLLK.', 'KLLLKKKLLLKKLLK.', '.KLLLLLLLLLLLK..', '..KKLLLLLLLKK...',
    '....KKLLLKK.....', '......KKK.......', '................', '......KDK.......',
    '.....KDDDK......', '....KDDDDDK.....', '.....KKKKK......', '................',
  ],
  flask: [
    '......KKKK......', '......KLLK......', '......KLLK......', '.....KKLLKK.....',
    '....KLLLLLLK....', '...KLLLLLLLLK...', '..KLLLLLLLLLLK..', '..KLPPPPPPPPLK..',
    '..KLPPPNPPPPLK..', '..KLPPPPPPPNPK..', '..KLPNPPPPPPLK..', '..KLPPPPPPPPLK..',
    '...KLPPPPPPLK...', '....KKKKKKKK....', '................', '................',
  ],

  // --- 魔法使いのわざ ---
  flame: [
    '.......KK.......', '......KOOK......', '......KOOK......', '.....KOOOOK.....',
    '.....KOYYOK.....', '....KOYYYYOK....', '....KOYYYYOK....', '...KOYYWWYYOK...',
    '...KOYYWWYYOK...', '..KOOYYWWYYOOK..', '..KOOYYYYYYOOK..', '..KOOOYYYYOOOK..',
    '...KOOOOOOOOK...', '....KKOOOOKK....', '......KKKK......', '................',
  ],
  bolt: [
    '..........KK....', '.........KYK....', '........KYYK....', '.......KYYK.....',
    '......KYYYK.....', '.....KYYYK......', '....KYYYYKKKK...', '...KYYYYYYYYK...',
    '...KKKKYYYYYK...', '......KYYYYK....', '.....KYYYK......', '....KYYYK.......',
    '...KYYK.........', '..KYYK..........', '..KYK...........', '..KK............',
  ],
  ice: [
    '.......KK.......', '......KWWK......', '..K...KWWK...K..', '..KK..KWWK..KK..',
    '...KK.KWWK.KK...', '....KKKWWKKK....', '.....KWWWWK.....', 'KKKKKWWWWWWKKKKK',
    'KWWWWWWWWWWWWWWK', 'KKKKKWWWWWWKKKKK', '.....KWWWWK.....', '....KKKWWKKK....',
    '...KK.KWWK.KK...', '..KK..KWWK..KK..', '..K...KWWK...K..', '......KKKK......',
  ],

  // --- 僧侶のわざ ---
  sparkle: [
    '.......KK.......', '......KWWK......', '......KWWK......', '...K..KYYK..K...',
    '...KK.KYYK.KK...', '....KKKYYKKK....', '.....KYYYYK.....', '.KKKKYYWWYYKKKK.',
    '.KYYYYYWWYYYYYK.', '.KKKKYYWWYYKKKK.', '.....KYYYYK.....', '....KKKYYKKK....',
    '...KK.KYYK.KK...', '...K..KWWK..K...', '......KWWK......', '.......KK.......',
  ],
  note: [
    '.........KKKKKK.', '.........KWWWWWK', '.........KWWWWWK', '.........KWKKKKK',
    '.........KWK....', '.........KWK....', '.........KWK....', '.........KWK....',
    '.........KWK....', '.......KKKWK....', '.....KKWWWWK....', '....KWWWWWWK....',
    '....KWWWWWK.....', '....KWWWWK......', '.....KKKK.......', '................',
  ],
  hammer: [
    '................', '..KKKKKKKKKK....', '.KLLLLLLLLLLK...', 'KLLLLLLLLLLLLK..',
    'KLLKKKKKKKKLLK..', 'KLLK......KLLK..', 'KLLKKKKKKKKLLK..', 'KLLLLLLLLLLLLK..',
    '.KLLLLKoKLLLLK..', '..KKKKKoKKKKK...', '.......KoK......', '.......KoK......',
    '.......KoK......', '.......KoK......', '.......KKK......', '................',
  ],

  // --- 強化カード ---
  heart: [
    '................', '..KKKK....KKKK..', '.KRRRRKKKKRRRRK.', 'KRRRRRRRRRRRRRRK',
    'KRRWRRRRRRRRRRRK', 'KRRWRRRRRRRRRRRK', 'KRRRRRRRRRRRRRRK', '.KRRRRRRRRRRRRK.',
    '..KRRRRRRRRRRK..', '...KRRRRRRRRK...', '....KRRRRRRK....', '.....KRRRRK.....',
    '......KRRK......', '.......KK.......', '................', '................',
  ],
  sword2: [
    '.......KK.......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '......KLWK......', '......KLWK......', '......KLWK......',
    '......KLWK......', '...KKKKLWKKKK...', '...KYYYYYYYYK...', '...KKKKooKKKK...',
    '......KooK......', '......KooK......', '......KKKK......', '................',
  ],
  torch2: [
    '................', '.......OO.......', '......OYYO......', '.....OYYYYO.....',
    '.....OYWWYO.....', '.....OYYYYO.....', '......OYYO......', '.......OO.......',
    '.......oo.......', '.......oo.......', '.......oo.......', '.......oo.......',
    '.......oo.......', '.......oo.......', '.......oo.......', '................',
  ],
  wing: [
    '................', '................', '...........KKK..', '........KKKWWWK.',
    '.....KKKWWWWWWK.', '..KKKWWWWWWWWWK.', '.KWWWWWWWWWWWWK.', '.KWWWWWWWWWWWK..',
    '.KWWWWWWWWWWK...', '.KWKWWKWWWWK....', '.KWKWWKWWWK.....', '..KKWKWWKK......',
    '....KKWK........', '......KK........', '................', '................',
  ],
  star: [
    '.......KK.......', '......KYYK......', '......KYYK......', '.....KYYYYK.....',
    '.....KYYYYK.....', 'KKKKKKYYYYKKKKKK', 'KYYYYYYYYYYYYYYK', '.KYYYYYYYYYYYYK.',
    '..KYYYYYYYYYYK..', '...KYYYYYYYYK...', '..KYYYYKKYYYYK..', '..KYYYK..KYYYK..',
    '.KYYYK....KYYYK.', '.KYYK......KYYK.', '.KKK........KKK.', '................',
  ],
  drop: [
    '.......KK.......', '.......KK.......', '......KRRK......', '......KRRK......',
    '.....KRRRRK.....', '.....KRRRRK.....', '....KRRRRRRK....', '....KRRRRRRK....',
    '...KRRRRRRRRK...', '...KRWRRRRRRK...', '..KRRWRRRRRRRK..', '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...', '....KRRRRRRK....', '.....KKKKKK.....', '................',
  ],
  burst: [
    '.......KK.......', '...K...KYK...K..', '...KK..KYK..KK..', '....KK.KYK.KK...',
    '.....KKKYKKK....', '......KYYYK.....', 'K.....KYWYK.....', 'KK...KYWWWYK...K',
    'KKKKKYWWWWWYKKKK', 'KK...KYWWWYK...K', 'K.....KYWYK.....', '......KYYYK.....',
    '.....KKKYKKK....', '....KK.KYK.KK...', '...KK..KYK..KK..', '...K...KKK...K..',
  ],

  // --- 画面上部のボタン ---
  question: [
    '................', '.....KKKKKK.....', '....KYYYYYYK....', '...KYYKKKKYYK...',
    '...KYYK..KYYK...', '...KKK...KYYK...', '.........KYYK...', '........KYYK....',
    '.......KYYK.....', '.......KYYK.....', '.......KYK......', '.......KKK......',
    '................', '.......KK.......', '......KYYK......', '.......KK.......',
  ],
  // 地図。16px で出すので、細かい模様は入れない。
  // 緑の点を散らした版を作ったら、縮んだときにただのノイズになった
  map: [
    '................', '..KKKKKKKKKKKK..', '..KWWWWWWWWWWK..', '..KWWKWWWWWWWK..',
    '..KWKKKWWWWWWK..', '..KWKWWKWWWWWK..', '..KWWWWKWWWWWK..', '..KWWWWKKWWWWK..',
    '..KWWWWWKKWWWK..', '..KWWWWWWKRRWK..', '..KWWWWWWKRRWK..', '..KWWWWWWWWWWK..',
    '..KKKKKKKKKKKK..', '................', '................', '................',
  ],
  sound: [
    '................', '..........KK....', '.........KWK....', '........KWWK....',
    '.......KWWWK.K..', '..KKKKKWWWWK.K..', '..KWWWWWWWWKK.K.', '..KWWWWWWWWK.K.K',
    '..KWWWWWWWWK.K.K', '..KWWWWWWWWKK.K.', '..KKKKKWWWWK.K..', '.......KWWWK.K..',
    '........KWWK....', '.........KWK....', '..........KK....', '................',
  ],
  mute: [
    '................', '..........KK....', '.........KWK....', '........KWWK....',
    '.......KWWWK....', '..KKKKKWWWWK.R.R', '..KWWWWWWWWK.RR.', '..KWWWWWWWWK..R.',
    '..KWWWWWWWWK.RR.', '..KKKKKWWWWK.R.R', '.......KWWWK....', '........KWWK....',
    '.........KWK....', '..........KK....', '................', '................',
  ],
  // --- 状態を文字で書かずに済ませるための印 ---
  lock: [
    '................', '.....KKKKKK.....', '....KLLLLLLK....', '...KLLKKKKLLK...',
    '...KLLK..KLLK...', '...KLLK..KLLK...', '..KKKKKKKKKKKK..', '..KYYYYYYYYYYK..',
    '..KYYYYYYYYYYK..', '..KYYYYKKYYYYK..', '..KYYYKKKKYYYK..', '..KYYYYKKYYYYK..',
    '..KYYYYKKYYYYK..', '..KYYYYYYYYYYK..', '..KKKKKKKKKKKK..', '................',
  ],
  check: [
    '................', '..............K.', '............KNK.', '...........KNNK.',
    '..........KNNK..', '.........KNNK...', '.K......KNNK....', 'KNK....KNNK.....',
    'KNNK..KNNK......', '.KNNKKNNK.......', '..KNNNNNK.......', '...KNNNK........',
    '....KNK.........', '.....K..........', '................', '................',
  ],
  skull: [
    '................', '....KKKKKKKK....', '...KWWWWWWWWK...', '..KWWWWWWWWWWK..',
    '..KWWWWWWWWWWK..', '..KWKKWWWWKKWK..', '..KWKKWWWWKKWK..', '..KWWWWWWWWWWK..',
    '..KWWWWKKWWWWK..', '..KWWWWKKWWWWK..', '...KWWWWWWWWK...', '....KWKWKWKWK...',
    '....KWKWKWKWK...', '.....KKKKKKK....', '................', '................',
  ],
  // --- メニュー ---
  cog: [
    '................', '......KKKK......', '...KKKLLLLKKK...', '..KLLLLLLLLLLK..',
    '..KLLLLLLLLLLK..', '.KLLLLKKKKLLLLK.', 'KKLLLK....KLLLKK', 'KLLLLK....KLLLLK',
    'KLLLLK....KLLLLK', 'KKLLLK....KLLLKK', '.KLLLLKKKKLLLLK.', '..KLLLLLLLLLLK..',
    '..KLLLLLLLLLLK..', '...KKKLLLLKKK...', '......KKKK......', '................',
  ],
  /*
   * 退却。扉から外へ出ていく矢印。
   *
   * 最初は扉を細く（5ドット）、矢印も細く描いたら、
   * 16px では「棒と点」にしか見えなかった。
   * **16px では、形は2つまで。それぞれ太く。**
   * 扉を左半分いっぱいに、矢印を右半分いっぱいに描き直した。
   *
   * 矢印は三角と軸ではなく、太い「＞」にした。
   * 三角で描くと 16px では潰れて、どちら向きか分からなくなる。
   * （実際、最初は左向きに見えていた。非常口の記号と同じ向きに揃える）
   */
  flee: [
    '................', '.KKKKKKK........', '.KGGGGGK........', '.KGLLLGK.KKK....',
    '.KGLLLGK.KRRK...', '.KGLLLGK..KRRK..', '.KGLLLGK...KRRK.', '.KGLLLGK....KRRK',
    '.KGLLLGK....KRRK', '.KGLLLGK...KRRK.', '.KGLLLGK..KRRK..', '.KGLLLGK.KRRK...',
    '.KGLLLGK.KKK....', '.KGGGGGK........', '.KKKKKKK........', '................',
  ],
  blank: [
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................', '................', '................', '................',
  ],
};

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

function toPng(width, height, pixels) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // フィルタなし
    for (let i = 0; i < width * 4; i++) raw[y * stride + 1 + i] = pixels[y * width * 4 + i];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 文字絵の並びから1枚の PNG を書き出す */
function buildSheet(layout, art, cols, outPath, tile = TILE) {
  const rows = Math.ceil(layout.length / cols);
  const W = cols * tile;
  const H = rows * tile;
  const px = new Uint8Array(W * H * 4);

  layout.forEach((name, index) => {
    const cell = art[name];
    if (!cell) throw new Error(`'${name}' の絵が無い`);
    if (cell.length !== tile) {
      throw new Error(`'${name}': ${cell.length} 行（${tile} 行であること）`);
    }

    const ox = (index % cols) * tile;
    const oy = Math.floor(index / cols) * tile;

    cell.forEach((line, y) => {
      if (line.length !== tile) {
        throw new Error(
          `'${name}' の ${y + 1} 行目: ${line.length} 文字（${tile} 文字であること）`,
        );
      }
      [...line].forEach((ch, x) => {
        if (!(ch in PALETTE)) throw new Error(`'${name}': 未定義の文字 '${ch}'`);
        const hex = PALETTE[ch];
        if (hex === null) return; // 透明
        const [r, g, b] = rgb(hex);
        const i = ((oy + y) * W + (ox + x)) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      });
    });
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toPng(W, H, px));
  console.log(`${outPath} （${W}x${H}, ${layout.length} 枚 / ${cols} 列）`);
}

const here = dirname(fileURLToPath(import.meta.url));

buildSheet(LAYOUT, ART, COLS, resolve(here, '../public/sprites/tiles.png'));
buildSheet(ICON_LAYOUT, ICON_ART, ICON_COLS, resolve(here, '../public/sprites/icons.png'));

/*
 * 立ち絵。1職業 1行、待機の2コマを横に並べる。
 * コマ送りは background-position-x を横へずらすだけなので、
 * **同じ職業のコマが折り返しをまたいではいけない。**
 */
const PORTRAIT_LAYOUT = [];
const PORTRAIT_ART = {};
for (const job of PORTRAIT_JOBS) {
  for (let f = 0; f < PORTRAIT_FRAMES; f++) {
    const name = f === 0 ? job : `${job}_b`;
    PORTRAIT_LAYOUT.push(name);
    PORTRAIT_ART[name] = drawPortrait(job, f);
  }
}
/*
 * **手で描いた立ち絵があれば、絶対に上書きしない。**
 *
 * ここが作るのは置きっぱなしの仮絵。本物は手で描く。
 * 盤のアイコンを1つ直すたびに `npm run sprites` を走らせるので、
 * 無条件に書くと、描いた絵がその1回で消える。
 * 作り直したいときは `npm run sprites -- --portraits` を付ける。
 */
const portraitPath = resolve(here, '../public/sprites/portraits.png');
const forcePortraits = process.argv.includes('--portraits');
if (!existsSync(portraitPath) || forcePortraits) {
  buildSheet(PORTRAIT_LAYOUT, PORTRAIT_ART, PORTRAIT_FRAMES, portraitPath, PORTRAIT_SIZE);
} else {
  console.log(`${portraitPath} （手描きがあるので触らない。作り直すなら -- --portraits）`);
}

console.log(`盤面の並び: ${LAYOUT.join(', ')}`);
console.log(`アイコンの並び: ${ICON_LAYOUT.join(', ')}`);
