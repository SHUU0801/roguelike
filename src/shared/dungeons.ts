import type { IconId } from './icons';
import type { ItemId } from './items';
import type { SpeciesId } from './monsters';
import type { SpriteId } from './sprites';

/**
 * ダンジョンの表。
 *
 * 1つしかないと、周回する理由が「もう一回やる」しかない。
 * 深さ・敵・地形が違うものを並べて、**踏破すると次が開く**ようにした。
 *
 * 持ち帰りの仕組み（07_ホームと周回.md）と合わせて、
 *
 *   浅いところで装備を集める → 深いところへ挑む → 死ぬと全部失う
 *
 * という往復が生まれる。周回そのものが目的になるのではなく、
 * **次のダンジョンに行けるだけの装備を作る**のが目的になる。
 */

export type DungeonId = 'tutorial' | 'ruin' | 'cave' | 'ice';

export type DungeonDef = {
  name: string;
  /** 選ぶ前に性格が分かる1行 */
  tagline: string;
  icon: IconId;
  /** 何階まで潜れば踏破か */
  depth: number;
  /** 地形の見た目。どこへ潜っても同じ絵だと、別の場所に来た気がしない */
  theme: { floor: SpriteId; wall: SpriteId };
  /** 出る敵 */
  monsters: SpeciesId[];
  /** 落ちているもの。重複させて重み付けにしている */
  items: ItemId[];
  /** 1フロアあたりの敵の数（深さでさらに増える） */
  monsterBase: [number, number];
  /** これを踏破するまで開かない。null なら最初から入れる */
  requires: DungeonId | null;
};

export const DUNGEONS = {
  /*
   * チュートリアル。
   *
   * 文章で読ませるのをやめて、**やって覚える**ようにした。
   * 地形も中身も固定（server/dungeon.ts の createTutorialFloor）。
   * 毎回同じでないと「次はここで殴る」と教えられない。
   *
   * 行き先の一覧（DUNGEON_IDS）には入れない。
   * 踏破数の分母に入ると、遊ぶ場所が4つあるように見えてしまう。
   */
  tutorial: {
    name: 'はじめの間',
    tagline: 'やって覚える',
    icon: 'question',
    depth: 1,
    theme: { floor: 'floor', wall: 'wall' },
    monsters: ['bat'],
    items: [],
    monsterBase: [0, 0],
    requires: null,
  },

  ruin: {
    name: '崩れた遺跡',
    tagline: '浅い。まずはここで装備を集める',
    icon: 'map',
    depth: 3,
    theme: { floor: 'floor', wall: 'wall' },
    monsters: ['bat', 'goblin'],
    items: ['potion', 'potion', 'potion', 'torch', 'torch', 'sword', 'shield', 'bomb'],
    monsterBase: [3, 4],
    requires: null,
  },

  cave: {
    name: '底なしの洞窟',
    tagline: '深くて広い。松明が足りなくなる',
    icon: 'torch2',
    depth: 5,
    theme: { floor: 'floor_cave', wall: 'wall_cave' },
    monsters: ['goblin', 'bat', 'slime'],
    items: ['potion', 'potion', 'torch', 'torch', 'torch', 'bomb', 'bomb', 'sword', 'shield', 'scroll'],
    monsterBase: [4, 6],
    requires: 'ruin',
  },

  ice: {
    name: '凍てつく回廊',
    tagline: '敵が硬い。殴るだけでは抜けられない',
    icon: 'ice',
    depth: 7,
    theme: { floor: 'floor_ice', wall: 'wall_ice' },
    monsters: ['slime', 'slime', 'goblin'],
    items: ['potion', 'torch', 'torch', 'bomb', 'sword', 'shield', 'shield', 'scroll', 'scroll'],
    monsterBase: [5, 7],
    requires: 'cave',
  },
} as const satisfies Record<DungeonId, DungeonDef>;

/**
 * 遊ぶ人が選べる行き先。**チュートリアルは入れない。**
 * Object.keys だと勝手に増えるので、手で並べる。
 */
export const DUNGEON_IDS: DungeonId[] = ['ruin', 'cave', 'ice'];

export function dungeonOf(id: string | null): DungeonDef {
  if (id === null) return DUNGEONS.ruin;
  return (DUNGEONS as unknown as Record<string, DungeonDef>)[id] ?? DUNGEONS.ruin;
}

export function isDungeonId(value: unknown): value is DungeonId {
  return typeof value === 'string' && value in DUNGEONS;
}

/** 踏破済みの一覧から、そのダンジョンに入れるか */
export function isUnlocked(id: DungeonId, cleared: readonly string[]): boolean {
  const need = DUNGEONS[id].requires;
  return need === null || cleared.includes(need);
}
