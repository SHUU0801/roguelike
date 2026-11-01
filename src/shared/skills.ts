/**
 * わざの表。
 *
 * 職業ごとに「最初から持っているもの1つ」＋「レベルアップのカードで覚えるもの2つ」。
 * 覚えると増えていくので、職業が同じでも育ち方で手札が変わる。
 *
 * 守っている約束（06_職業とレベルの設計.md §2）:
 *
 *   - **乱数を使わない。** ダメージ計算と同じ理由。対戦へ持っていくとき書き直さずに済む
 *   - **狙う相手を選ばせない。** 北→東→南→西の決まった順で自動的に決める。
 *     順番が一定なら、慣れた人は位置取りで狙う相手を操作できる
 *   - 1ターンぶんの行動。使ったら移動も攻撃もできない
 *   - 空振りしたら待ち時間を使わない（罰ではなく判断にする）
 */

import type { JobId } from './jobs';

export type SkillId =
  // 戦士
  | 'cleave'
  | 'taunt'
  | 'bulwark'
  // 盗賊
  | 'backstab'
  | 'vanish'
  | 'venom'
  // 魔法使い
  | 'fireball'
  | 'bolt'
  | 'frost'
  // 僧侶
  | 'heal'
  | 'bless'
  | 'smite';

export type SkillDef = {
  name: string;
  desc: string;
  glyph: string;
  job: JobId;
  /** 使ったあと何ターン使えないか */
  cooldown: number;
};

export const SKILLS = {
  // --- 戦士 ---
  cleave: {
    name: 'ぶんまわし',
    desc: '隣にいる敵すべてを一度に殴る',
    glyph: '🪓',
    job: 'warrior',
    cooldown: 4,
  },
  taunt: {
    name: '挑発',
    desc: '周りの敵全部をこちらに向かせ、3ターン自分の防御 +3',
    glyph: '📢',
    job: 'warrior',
    cooldown: 6,
  },
  bulwark: {
    name: '盾の構え',
    desc: '4ターン、受けるダメージを半分にする',
    glyph: '🛡️',
    job: 'warrior',
    cooldown: 7,
  },

  // --- 盗賊 ---
  backstab: {
    name: 'きゅうしょづき',
    desc: '隣の敵1体に、防御を無視した攻撃力ぶんのダメージ',
    glyph: '🗡️',
    job: 'rogue',
    cooldown: 4,
  },
  vanish: {
    name: 'かげがくれ',
    desc: '4ターン、敵に見つからなくなる（追ってきた敵も見失う）',
    glyph: '🌫️',
    job: 'rogue',
    cooldown: 8,
  },
  venom: {
    name: 'どくばり',
    desc: '隣の敵1体を毒にする。5ターンのあいだ毎ターン 3 ダメージ',
    glyph: '🧪',
    job: 'rogue',
    cooldown: 5,
  },

  // --- 魔法使い ---
  fireball: {
    name: 'かえんだん',
    desc: '同じ列か行にいる、壁に遮られていない一番近い敵を撃つ',
    glyph: '🔥',
    job: 'mage',
    cooldown: 5,
  },
  bolt: {
    name: 'いなずま',
    desc: '一直線に貫く。その線上の敵すべてに当たる',
    glyph: '⚡',
    job: 'mage',
    cooldown: 6,
  },
  frost: {
    name: 'こおりのやり',
    desc: '一番近い敵を3ターン凍らせる（動けない）',
    glyph: '❄️',
    job: 'mage',
    cooldown: 6,
  },

  // --- 僧侶 ---
  heal: {
    name: 'いやしのひかり',
    desc: '自分と、隣にいる仲間の体力を回復する',
    glyph: '✨',
    job: 'cleric',
    cooldown: 5,
  },
  bless: {
    name: 'まもりのうた',
    desc: '自分と隣の仲間の防御を 4ターン +2',
    glyph: '🎵',
    job: 'cleric',
    cooldown: 6,
  },
  smite: {
    name: 'さばき',
    desc: '隣の敵1体に固定ダメージ。当たった敵は1ターン動けない',
    glyph: '🔨',
    job: 'cleric',
    cooldown: 5,
  },
} as const satisfies Record<SkillId, SkillDef>;

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export function skillOf(skillId: string): SkillDef {
  return (SKILLS as Record<string, SkillDef>)[skillId] ?? SKILLS.cleave;
}

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && value in SKILLS;
}

/** 職業が最初から持っているわざ */
export const BASE_SKILL: Record<JobId, SkillId> = {
  warrior: 'cleave',
  rogue: 'backstab',
  mage: 'fireball',
  cleric: 'heal',
};

/**
 * 盤上の一時的な状態。
 *
 * Actor に専用の欄を1つずつ足していくと、毒・凍結・隠密・防御上昇…と
 * 増えるたびに型も初期化も check も直すことになる。
 * 「いつまで効いているか」の表1つにまとめておけば、増えても形が変わらない。
 *
 * 値は「このターンまで効いている」。state.turn と比べて判定する。
 */
export type EffectId =
  /** 動けない。凍結・気絶をまとめてこれで表す */
  | 'stun'
  /** 毎ターン傷つく */
  | 'poison'
  /** 敵に見つからない */
  | 'hidden'
  /** 防御の上乗せ */
  | 'guard'
  /** 受けるダメージが半分 */
  | 'bulwark';

export const EFFECT_LABEL: Record<EffectId, string> = {
  stun: '動けない',
  poison: '毒',
  hidden: '隠れている',
  guard: '防御上昇',
  bulwark: '守り',
};

/** 毒の1ターンぶんのダメージ */
export const POISON_DAMAGE = 3;
/** 挑発の防御上乗せ */
export const GUARD_BONUS = 3;
/** まもりのうたの防御上乗せ */
export const BLESS_BONUS = 2;
