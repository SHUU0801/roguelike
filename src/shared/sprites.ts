/**
 * スプライトシートの定義。
 *
 * 1枚の PNG に 16×16 のタイルを並べたものを、CSS の背景画像として切り出して使う。
 * Canvas は使わない（設計書 §7）。
 *
 * 画像は tools/make-sprites.mjs が生成する仮のもの（`npm run sprites`）。
 * 0x72 DungeonTileset II（CC0, 16×16）などの本物の素材に差し替えるときは、
 * 同じ並び順で public/sprites/tiles.png を置き換えるだけでいい。
 */

export const SHEET = {
  url: '/sprites/tiles.png',
  tile: 16,
  cols: 6,
  rows: 2,
} as const;

export type SpriteId =
  | 'floor'
  | 'wall'
  | 'stairs'
  | 'hero'
  | 'goblin'
  | 'bat'
  | 'slime'
  | 'potion'
  | 'bomb'
  | 'sword'
  | 'shield'
  | 'scroll';

/** シート上の通し番号。左上から右へ、折り返して下へ */
export const SPRITE_INDEX: Record<SpriteId, number> = {
  floor: 0,
  wall: 1,
  stairs: 2,
  hero: 3,
  goblin: 4,
  bat: 5,
  slime: 6,
  potion: 7,
  bomb: 8,
  sword: 9,
  shield: 10,
  scroll: 11,
};

/** 地形 → スプライト */
export const TILE_SPRITE = {
  floor: 'floor',
  wall: 'wall',
  stairs: 'stairs',
} as const satisfies Record<string, SpriteId>;
