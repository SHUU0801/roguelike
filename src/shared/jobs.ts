/**
 * 職業の表。
 *
 * これは 03_改善構成.md §2-4 の「クラスを入れずに、開始アイテムで役割を分ける」
 * という判断を覆すもの。覆したうえで、そこで避けたかったことは守る:
 *
 *   - 性能差は**最初から全部見えている**。隠しステータスも成長の当たり外れも無い
 *   - どの職業も同じコンテンツ（敵・アイテム・フロア）の上で戦う
 *   - 対戦（段階D）ではドラフトの選択肢になる。4種を両チームが同じ条件で選べる
 *
 * レベルで def が伸びないのが重要（詳細は types.ts の LEVEL_GROWTH）。
 */

import type { ItemId } from './items';

export type JobId = 'warrior' | 'rogue' | 'mage' | 'cleric';

export type JobDef = {
  name: string;
  /** 選択画面に出す1行。選ぶ前に違いが分かる必要がある */
  tagline: string;
  glyph: string;
  maxHp: number;
  atk: number;
  def: number;
  /** レベルが1上がるごとの伸び。def は伸びない（types.ts 参照） */
  hpPerLevel: number;
  atkPerLevel: number;
  /** 開始時に配るもの。職業の役割を1ターン目から持たせる */
  startingItem: ItemId;
  skill: SkillDef;
};

export type SkillDef = {
  name: string;
  /** ボタンの下と、あそびかたに出す説明 */
  desc: string;
  /** 使ったあと何ターン使えないか */
  cooldown: number;
};

/**
 * 性能の考え方:
 *
 *   戦士   固い。前に立って殴られ続ける係
 *   盗賊   柔らかいが一番殴れる。硬い敵を溶かす係
 *   魔法使い 一番柔らかい。唯一の遠距離攻撃
 *   僧侶   中くらい。唯一の回復手段（薬草に頼らずに済む）
 *
 * 4人そろうと噛み合うが、1人でも成立する（公開しているので1人で来る人がいる）。
 */
export const JOBS = {
  warrior: {
    name: '戦士',
    tagline: '固い。前に立って受ける',
    glyph: '🛡️',
    maxHp: 30,
    atk: 6,
    def: 3,
    hpPerLevel: 6,
    atkPerLevel: 1,
    startingItem: 'shield',
    skill: {
      name: 'ぶんまわし',
      desc: '隣にいる敵すべてを一度に殴る',
      cooldown: 4,
    },
  },

  rogue: {
    name: '盗賊',
    tagline: '柔らかいが一番殴れる',
    glyph: '🗡️',
    maxHp: 22,
    atk: 8,
    def: 1,
    hpPerLevel: 4,
    atkPerLevel: 2,
    startingItem: 'sword',
    skill: {
      name: 'きゅうしょづき',
      desc: '隣の敵1体に、防御を無視した攻撃力ぶんのダメージ',
      cooldown: 4,
    },
  },

  mage: {
    name: '魔法使い',
    tagline: '一番柔らかい。唯一の遠距離攻撃',
    glyph: '🔥',
    maxHp: 18,
    atk: 5,
    def: 1,
    hpPerLevel: 3,
    atkPerLevel: 1,
    startingItem: 'bomb',
    skill: {
      name: 'かえんだん',
      desc: '同じ列か行にいる、壁に遮られていない一番近い敵を撃つ',
      cooldown: 5,
    },
  },

  cleric: {
    name: '僧侶',
    tagline: '唯一の回復手段',
    glyph: '✨',
    maxHp: 26,
    atk: 5,
    def: 2,
    hpPerLevel: 5,
    atkPerLevel: 1,
    startingItem: 'potion',
    skill: {
      name: 'いやしのひかり',
      desc: '自分と、隣にいる仲間の体力を回復する',
      cooldown: 5,
    },
  },
} as const satisfies Record<JobId, JobDef>;

export const JOB_IDS = Object.keys(JOBS) as JobId[];

/** 不明な値が来ても落ちないように、既定は戦士 */
export function jobOf(jobId: string | null): JobDef {
  if (jobId === null) return JOBS.warrior;
  return (JOBS as Record<string, JobDef>)[jobId] ?? JOBS.warrior;
}

export function isJobId(value: unknown): value is JobId {
  return typeof value === 'string' && value in JOBS;
}

/**
 * スキルの威力。レベルで伸びる。
 *
 * 攻撃力に乗せず別の式にしているのは、魔法使いと僧侶の伸びをここに集めるため。
 * この2人は atkPerLevel が 1 しかないので、スキルが伸びないと後半で置いていかれる。
 */
export function fireballDamage(level: number): number {
  return 6 + level * 2;
}

export function healAmount(level: number): number {
  return 5 + level * 2;
}
