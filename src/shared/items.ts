/**
 * アイテムの効果表。実装は Week 4。
 *
 * pvpSafe は v1.5（2vs2 対戦）への仕込み。
 * 「運で負けた」を構造で消すため、運に依存する効果は対戦では使わない or 確定化する。
 * 先に印を付けておけば、v1.5 でこの表を見るだけで判断できる。
 */

export type ItemDef = {
  name: string;
  glyph: string;
  /** 対戦でそのまま使えるか（false = 効果が運に依存する） */
  pvpSafe: boolean;
};

export const ITEMS = {
  potion: { name: '薬草', glyph: '🧪', pvpSafe: true },
  bomb: { name: '爆弾', glyph: '💣', pvpSafe: true },
  sword: { name: '剣', glyph: '🗡️', pvpSafe: true },
  shield: { name: '盾', glyph: '🛡️', pvpSafe: true },
  scroll: { name: '転移の巻物', glyph: '📜', pvpSafe: false },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function itemDefOf(itemId: string): ItemDef {
  return (ITEMS as Record<string, ItemDef>)[itemId] ?? ITEMS.potion;
}
