/**
 * レベルアップで選ぶ強化カードの表。
 *
 * レベルが上がると3枚出て、1枚だけ取れる。取らなかった2枚は消える。
 *
 * なぜ「自動で強くなる」ではなくカードにしたか:
 * 自動成長だと、レベルは時間が経てば必ず手に入るただの数字になる。
 * 選ばせると、同じ職業でも毎回ちがう形に育ち、
 * 「毎回ちがう持ち物でやりくりする」というこのゲームの芯と噛み合う。
 *
 * **引きは対戦でも運のままにする。** 消したいのは「同じ判断をしたのに結果が違う」運
 * （攻撃が外れる類い）であって、運そのものではない。
 * カードは決める前に全部見えるので、引きが変われば作戦が変わる。
 * 運が判断を生む側に回っているぶんには入れていい。
 */

import type { IconId } from './icons';
import type { JobId } from './jobs';
import { SKILLS, type SkillId } from './skills';

export type PerkId =
  // どの職業にも出る
  | 'vitality'
  | 'power'
  | 'guard'
  | 'torch'
  | 'swift'
  | 'focus'
  | 'mend'
  | 'surge'
  // 職業ごと。新しいわざを覚える
  | 'learn_taunt'
  | 'learn_bulwark'
  | 'learn_vanish'
  | 'learn_venom'
  | 'learn_bolt'
  | 'learn_frost'
  | 'learn_bless'
  | 'learn_smite';

export type PerkDef = {
  name: string;
  desc: string;
  icon: IconId;
  /** あるとその職業にしか出ない */
  job?: JobId;
  /** あると新しいわざを覚える */
  learn?: SkillId;
  /**
   * 同じカードを取れる上限。
   *
   * guard が 3 で止まるのが肝。ダメージは atk - def（最低1）なので、
   * 防御を積み続けると敵の攻撃が全部1になり、ゲームが終わる。
   * 03_改善構成.md §1-3 で一度潰した「防御の天井」問題が、
   * 上限を付けないとカードの形で戻ってくる。
   */
  maxStacks: number;
};

/** わざを覚えるカードの定義を、わざの表から組み立てる。二重に書かないため */
function skillCard(job: JobId, skill: SkillId): PerkDef {
  const def = SKILLS[skill];
  return {
    name: `${def.name}を覚える`,
    desc: def.desc,
    icon: def.icon,
    job,
    learn: skill,
    maxStacks: 1,
  };
}

export const PERKS = {
  vitality: {
    name: '頑健',
    desc: '最大体力 +8（その場で +8 回復）',
    icon: 'heart',
    maxStacks: 99,
  },
  power: {
    name: '剛力',
    desc: '攻撃力 +2',
    icon: 'sword2',
    maxStacks: 99,
  },
  guard: {
    name: '鉄壁',
    desc: '防御力 +1',
    icon: 'shield2',
    maxStacks: 3,
  },
  torch: {
    name: '長い芯',
    desc: '松明 +80',
    icon: 'torch2',
    maxStacks: 99,
  },
  swift: {
    name: '早業',
    desc: '職業スキルの待ちが 1 ターン短くなる',
    icon: 'wing',
    maxStacks: 2,
  },
  focus: {
    name: '極め',
    desc: '職業スキルの威力 +4',
    icon: 'star',
    maxStacks: 3,
  },
  mend: {
    name: '吸命',
    desc: '敵を倒すたび体力 +2',
    icon: 'drop',
    maxStacks: 2,
  },
  surge: {
    name: '底力',
    desc: '体力が全快し、最大体力 +4',
    icon: 'burst',
    maxStacks: 99,
  },

  /*
   * ここから下は職業ごとのカード。新しいわざを覚える。
   *
   * 能力値だけのカードだと、どの職業も同じ育ち方をする。
   * わざが増えれば手札そのものが変わるので、
   * 同じ魔法使いでも「いなずま型」と「こおり型」に分かれる。
   *
   * maxStacks は 1。覚えたら出てこない（levels.ts が取り除く）。
   */
  learn_taunt: skillCard('warrior', 'taunt'),
  learn_bulwark: skillCard('warrior', 'bulwark'),
  learn_vanish: skillCard('rogue', 'vanish'),
  learn_venom: skillCard('rogue', 'venom'),
  learn_bolt: skillCard('mage', 'bolt'),
  learn_frost: skillCard('mage', 'frost'),
  learn_bless: skillCard('cleric', 'bless'),
  learn_smite: skillCard('cleric', 'smite'),
} as const satisfies Record<PerkId, PerkDef>;

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

/** 何枚出すか。3枚なら迷えて、かつスマホの縦に並ぶ */
export const OFFER_COUNT = 3;

export function perkOf(perkId: string): PerkDef {
  return (PERKS as Record<string, PerkDef>)[perkId] ?? PERKS.vitality;
}

export function isPerkId(value: unknown): value is PerkId {
  return typeof value === 'string' && value in PERKS;
}

/** そのカードを何枚取ったか */
export function perkCount(perks: PerkId[], perkId: PerkId): number {
  return perks.filter((p) => p === perkId).length;
}
