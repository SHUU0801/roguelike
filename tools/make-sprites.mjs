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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // 3行目: 職業ごとの姿。全員が同じ冒険者だと、盤の上で誰が何なのか分からない
  'warrior', 'warrior_b', 'rogue', 'rogue_b', 'mage', 'mage_b', 'cleric', 'cleric_b', 'blank',
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
  // 「明るい＝歩ける」に統一する。
  // 壁を床より明るくすると、初見が明るいところを道だと思って押してしまう。
  1: '#2b3340', // 床（盤面で一番明るい）
  2: '#343d4c', // 床の模様
  3: '#13161b', // 目地
  4: '#222730', // レンガ（床より暗い）
};

const ART = {
  floor: [
    '1111111111111111', '1111121111111111', '1111111111112111', '1211111111111111',
    '1111111121111111', '1111111111111111', '1111211111111111', '1111111111121111',
    '1111111111111111', '1121111111111111', '1111111111111111', '1111112111111111',
    '1111111111111121', '1111111111111111', '1112111111111111', '1111111111111111',
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
  'sound', 'mute', 'blank', 'blank', 'blank', 'blank', 'blank', 'blank',
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
function buildSheet(layout, art, cols, outPath) {
  const rows = Math.ceil(layout.length / cols);
  const W = cols * TILE;
  const H = rows * TILE;
  const px = new Uint8Array(W * H * 4);

  layout.forEach((name, index) => {
    const cell = art[name];
    if (!cell) throw new Error(`'${name}' の絵が無い`);
    if (cell.length !== TILE) {
      throw new Error(`'${name}': ${cell.length} 行（${TILE} 行であること）`);
    }

    const ox = (index % cols) * TILE;
    const oy = Math.floor(index / cols) * TILE;

    cell.forEach((line, y) => {
      if (line.length !== TILE) {
        throw new Error(
          `'${name}' の ${y + 1} 行目: ${line.length} 文字（${TILE} 文字であること）`,
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

console.log(`盤面の並び: ${LAYOUT.join(', ')}`);
console.log(`アイコンの並び: ${ICON_LAYOUT.join(', ')}`);
