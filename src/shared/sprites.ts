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
  cols: 8,
  rows: 2,
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
  | 'hero'
  | 'goblin'
  | 'bat'
  | 'slime';

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
  // 以下は2コマ。次の枠（index + 1）が2コマ目
  hero: 8,
  goblin: 10,
  bat: 12,
  slime: 14,
};

/** 2コマのアニメーションを持つもの。2コマ目は index + 1 */
export const ANIMATED: ReadonlySet<SpriteId> = new Set<SpriteId>([
  'hero',
  'goblin',
  'bat',
  'slime',
]);

/** 地形 → スプライト */
export const TILE_SPRITE = {
  floor: 'floor',
  wall: 'wall',
  stairs: 'stairs',
} as const satisfies Record<string, SpriteId>;
