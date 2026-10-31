/**
 * 種族の性能表。
 *
 * GameState に性能を入れず、こちらの表に置く理由（設計書 §3-1）:
 * 状態は毎ターン通信で流れるので小さく保つ。性能表は試合中に変わらないので、
 * クライアントが最初から持っていればいい。
 */

export type SpeciesDef = {
  name: string;
  glyph: string;
  maxHp: number;
  atk: number;
  def: number;
};

export const SPECIES = {
  hero: { name: '冒険者', glyph: '🧑', maxHp: 24, atk: 6, def: 2 },

  // Week 3 で使う。まだ盤上には出ない。
  goblin: { name: 'ゴブリン', glyph: '👺', maxHp: 8, atk: 4, def: 1 },
  bat: { name: 'コウモリ', glyph: '🦇', maxHp: 5, atk: 3, def: 0 },
  slime: { name: 'スライム', glyph: '🟢', maxHp: 12, atk: 3, def: 3 },
} as const satisfies Record<string, SpeciesDef>;

export type SpeciesId = keyof typeof SPECIES;

/** 不明な speciesId でも落ちないように、見つからなければ冒険者扱いにする */
export function speciesOf(speciesId: string): SpeciesDef {
  return (SPECIES as Record<string, SpeciesDef>)[speciesId] ?? SPECIES.hero;
}
