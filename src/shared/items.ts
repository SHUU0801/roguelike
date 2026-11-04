/**
 * アイテムの効果表。実装は Week 4。
 *
 * pvpSafe は v1.5（2vs2 対戦）への仕込み。
 * 「運で負けた」を構造で消すため、運に依存する効果は対戦では使わない or 確定化する。
 * 先に印を付けておけば、v1.5 でこの表を見るだけで判断できる。
 */

import type { SpriteId } from './sprites';

export type ItemDef = {
  name: string;
  /** 画像が読めなかったときの保険 */
  glyph: string;
  sprite: SpriteId;
  /** 対戦でそのまま使えるか（false = 効果が運に依存する） */
  pvpSafe: boolean;
  /**
   * 身に着けている間ずっと効く補正。
   *
   * **袋に入っている間だけ効く。** 以前は「使う」と消えて能力が上がりっぱなしだった。
   * それだと、使った瞬間に袋が空くので**持っているほうが損**になる。
   * 装備が袋のマスを食い続けるからこそ、
   * 「剣を2本持つか、薬草を入れるか」が judgment になる。
   */
  equip?: { atk?: number; def?: number };
  /**
   * バックパックの中で占めるマス。[横, 縦] の組の並び。左上を (0,0) とする。
   *
   * 「6個まで」という数の制限をやめて形にした理由（07_ホームと周回.md §3）:
   * 数だけだと、薬草6個と剣6本が同じ重さになる。形があると
   * 「剣は縦3マス食うから、もう1本は諦めて薬草を入れる」という判断が生まれる。
   */
  shape: readonly (readonly [number, number])[];
};

/** 形の外接する大きさ [横, 縦] */
export function shapeSize(shape: ItemDef['shape']): [number, number] {
  let w = 0;
  let h = 0;
  for (const [x, y] of shape) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  return [w, h];
}

/** 90度回した形。向きは0と1の2つだけ（180度は見た目が同じなので要らない） */
export function rotated(shape: ItemDef['shape'], rot: number): [number, number][] {
  if (rot % 2 === 0) return shape.map(([x, y]) => [x, y]);
  const [, h] = shapeSize(shape);
  // (x, y) -> (h-1-y, x)
  return shape.map(([x, y]) => [h - 1 - y, x]);
}

const DOT = [[0, 0]] as const;
const TALL2 = [[0, 0], [0, 1]] as const;
const TALL3 = [[0, 0], [0, 1], [0, 2]] as const;
const WIDE2 = [[0, 0], [1, 0]] as const;
const BLOCK = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;

export const ITEMS = {
  potion: { name: '薬草', glyph: '🧪', sprite: 'potion', pvpSafe: true, shape: DOT },
  bomb: { name: '爆弾', glyph: '💣', sprite: 'bomb', pvpSafe: true, shape: DOT },
  // 正負を付けてあるのは 03_改善構成.md §1-4 の決定。
  // デメリットが1つ付くだけで「拾ったら装備」が「今どっちが要るか」に変わる
  sword: {
    name: '剣',
    glyph: '🗡️',
    sprite: 'sword',
    pvpSafe: true,
    shape: TALL3,
    equip: { atk: 4, def: -1 },
  },
  shield: {
    name: '盾',
    glyph: '🛡️',
    sprite: 'shield',
    pvpSafe: true,
    shape: BLOCK,
    equip: { def: 3, atk: -1 },
  },
  scroll: { name: '転移の巻物', glyph: '📜', sprite: 'scroll', pvpSafe: true, shape: WIDE2 },
  torch: { name: '松明', glyph: '🔥', sprite: 'torch', pvpSafe: true, shape: TALL2 },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

/** 外から来た文字列が本当にアイテムの id か。通信の本文を信じないため */
export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && v in ITEMS;
}

export function itemDefOf(itemId: string): ItemDef {
  return (ITEMS as Record<string, ItemDef>)[itemId] ?? ITEMS.potion;
}

/** 使えるもの（装備ではないもの）か */
export function isUsable(itemId: string): boolean {
  return itemDefOf(itemId).equip === undefined;
}
