/**
 * スプライトシートの定義。
 *
 * 1枚の PNG に 16×16 のタイルを並べたものを、CSS の背景画像として切り出して使う。
 * Canvas は使わない（設計書 §7）。
 *
 * 生き物は2コマ。シート上で隣り合わせに置いてあり（index と index+1）、
 * CSS が background-position-x を steps() で切り替えてパラパラ動かす。
 *
 * 画像は tools/make-sprites.mjs が生成する（`npm run sprites`）。
 * 0x72 DungeonTileset II（CC0, 16×16）などの本物の素材に差し替えるときは、
 * **この並び順と同じ** PNG を public/sprites/tiles.png に置けばいい。
 */

export const SHEET = {
  url: '/sprites/tiles.png',
  tile: 16,
  cols: 9,
  rows: 5,
} as const;

export type SpriteId =
  | 'floor'
  | 'wall'
  | 'stairs'
  | 'potion'
  | 'bomb'
  | 'sword'
  | 'shield'
  | 'scroll'
  | 'torch'
  | 'hero'
  | 'goblin'
  | 'bat'
  | 'slime'
  // 職業ごとの姿
  | 'warrior'
  | 'rogue'
  | 'mage'
  | 'cleric'
  // ダンジョンごとの地形
  | 'floor_cave'
  | 'wall_cave'
  | 'floor_ice'
  | 'wall_ice';

/**
 * シート上の通し番号。左上から右へ、折り返して下へ。
 * tools/make-sprites.mjs の LAYOUT と必ず一致させること。
 */
export const SPRITE_INDEX: Record<SpriteId, number> = {
  floor: 0,
  wall: 1,
  stairs: 2,
  potion: 3,
  bomb: 4,
  sword: 5,
  shield: 6,
  scroll: 7,
  torch: 8,
  // 以下は2コマ。次の枠（index + 1）が2コマ目
  hero: 9,
  goblin: 11,
  bat: 13,
  slime: 15,
  // 3〜4行目。1職業4コマ（待機2 + 歩き2）で、折り返しをまたがないよう1行2職業
  warrior: 18,
  rogue: 22,
  mage: 27,
  cleric: 31,
  // 5行目
  floor_cave: 36,
  wall_cave: 37,
  floor_ice: 38,
  wall_ice: 39,
};

/**
 * 歩きのコマ。index + 2 と index + 3 が歩きの2コマ。
 *
 * 待機コマ（index + 1）は全体を1ドット下げただけで、これは呼吸に見える。
 * **歩いて見せるには足が入れ替わる必要がある。**
 */
export const WALKS: ReadonlySet<SpriteId> = new Set<SpriteId>([
  'warrior',
  'rogue',
  'mage',
  'cleric',
]);

/** 2コマのアニメーションを持つもの。2コマ目は index + 1 */
export const ANIMATED: ReadonlySet<SpriteId> = new Set<SpriteId>([
  'hero',
  'goblin',
  'bat',
  'slime',
  'warrior',
  'rogue',
  'mage',
  'cleric',
]);

/** 地形 → スプライト */
export const TILE_SPRITE = {
  floor: 'floor',
  wall: 'wall',
  stairs: 'stairs',
} as const satisfies Record<string, SpriteId>;
