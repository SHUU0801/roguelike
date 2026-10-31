/**
 * 種族の性能表。
 *
 * GameState に性能を入れず、こちらの表に置く理由（設計書 §3-1）:
 * 状態は毎ターン通信で流れるので小さく保つ。性能表は試合中に変わらないので、
 * クライアントが最初から持っていればいい。
 */

import type { SpriteId } from './sprites';

export type SpeciesDef = {
  name: string;
  /** 画像が読めなかったときの保険。スプライトが出るときは使わない */
  glyph: string;
  sprite: SpriteId;
  maxHp: number;
  atk: number;
  def: number;
};

export const SPECIES = {
  hero: { name: '冒険者', glyph: '🧑', sprite: 'hero', maxHp: 24, atk: 6, def: 2 },

  // Week 3 で使う。まだ盤上には出ない。
  // 数値は 03_改善構成.md §1-3, §1-4 の修正。**まとめて変えること**。
  // 片方だけ触ると壊れる（敵を強くせずに剣に def-1 を付けると、ただ弱くなる）。
  //
  // 旧: goblin hp8/atk4, bat hp5/atk3, slime hp12/atk3
  // コウモリは hp5 では冒険者の一撃（6〜8）で必ず死に、
  // しかも移動と攻撃が別ターンなので一度も殴れていなかった。
  goblin: { name: 'ゴブリン', glyph: '👺', sprite: 'goblin', maxHp: 13, atk: 6, def: 1 },
  bat: { name: 'コウモリ', glyph: '🦇', sprite: 'bat', maxHp: 10, atk: 5, def: 0 },
  slime: { name: 'スライム', glyph: '🟢', sprite: 'slime', maxHp: 14, atk: 5, def: 3 },
} as const satisfies Record<string, SpeciesDef>;

export type SpeciesId = keyof typeof SPECIES;

/** 不明な speciesId でも落ちないように、見つからなければ冒険者扱いにする */
export function speciesOf(speciesId: string): SpeciesDef {
  return (SPECIES as Record<string, SpeciesDef>)[speciesId] ?? SPECIES.hero;
}
