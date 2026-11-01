import { jobOf } from '../shared/jobs';
import { speciesOf } from '../shared/monsters';
import {
  OFFER_COUNT,
  PERKS,
  PERK_IDS,
  perkCount,
  perkOf,
  type PerkId,
} from '../shared/perks';
import { MAX_LEVEL, expToNext, type Actor, type GameState } from '../shared/types';
import { pushLog } from './game';
import { shuffle } from './random';

/**
 * 経験値とレベルアップ。
 *
 * ## 経験値はパーティ全員に同じだけ入る
 *
 * 倒した本人だけに入れると2つ壊れる。
 * 「とどめを刺したのは誰か」で揉める（協力なのに取り合いになる）。
 * そして倒れている人が永久に置いていかれる。
 * 段階Cで「倒れた人にも仕事を残す」と決めた判断と正面からぶつかる。
 *
 * 全員同額なら、誰が殴っても同じなので、誰が前に出るかを素直に相談できる。
 *
 * ## 対戦（段階D）での扱い
 *
 * レベル差は対戦で雪だるまになる。片方が先に育つと、
 * 育ったほうがさらに倒しやすくなって差が開く一方になる。
 * そのときは `awardExp` を呼ばないだけでいい。入口が1つなのはそのため。
 */
export function awardExp(state: GameState, amount: number): void {
  if (amount <= 0) return;

  // 倒れている人にも入れる。蘇生したときに置いていかれていると、
  // 起こしてもらっても戦力にならず、結局その人の出番が戻らない
  for (const actor of state.actors) {
    if (actor.kind !== 'player') continue;
    actor.exp += amount;
    levelUpWhilePossible(state, actor);
  }
}

/** モンスターを倒したときの経験値 */
export function expFor(monster: Actor): number {
  return speciesOf(monster.speciesId).exp;
}

function levelUpWhilePossible(state: GameState, actor: Actor): void {
  while (actor.level < MAX_LEVEL && actor.exp >= expToNext(actor.level)) {
    actor.exp -= expToNext(actor.level);
    actor.level += 1;

    // 職業ぶんの伸びはここで自動。カードはそれとは別に1枚選べる。
    // 自動ぶんが無いと、カードを選ばないまま進めた人が一切強くならない
    const job = jobOf(actor.job);
    actor.maxHp += job.hpPerLevel;
    actor.hp += job.hpPerLevel;
    actor.atk += job.atkPerLevel;

    actor.pendingLevels += 1;
    pushLog(state, `${actor.slot}番がレベル ${actor.level} になった`);
  }

  // 選ぶのを後回しにしていても、カードは出したままにしておく
  if (actor.pendingLevels > 0 && actor.offers.length === 0) {
    actor.offers = rollOffers(actor);
  }
}

/**
 * 出す3枚を引く。
 *
 * 上限まで取ったカードは出さない。出すと「選べない1枚」が混ざって、
 * 3枚から選ぶはずが実質2枚になる。
 *
 * **引きは対戦でも運のままでいい。** 決める前に3枚とも見えるので、
 * 引きが変われば作戦が変わる。消したいのは「同じ判断をしたのに結果が違う」運。
 */
export function rollOffers(actor: Actor): PerkId[] {
  const available = PERK_IDS.filter((id) => {
    const def = perkOf(id);
    // 他の職業のカードは出さない
    if (def.job !== undefined && def.job !== actor.job) return false;
    // もう覚えているわざは出さない
    if (def.learn !== undefined && actor.skills.includes(def.learn)) return false;
    return perkCount(actor.perks, id) < def.maxStacks;
  });

  /*
   * 覚えられるわざが残っていれば、3枚のうち1枚は必ずわざにする。
   *
   * 完全にシャッフルすると、能力値のカードが8種に対してわざは2種しかないので、
   * 最後までわざを1つも覚えないまま終わる人が普通に出る。
   * それだと「職業ごとにわざがほしい」が成立しない。
   * どのわざが出るかは運のままなので、引きの面白さは残る。
   */
  const skillCards = available.filter((id) => perkOf(id).learn !== undefined);
  const rest = available.filter((id) => perkOf(id).learn === undefined);

  if (skillCards.length === 0) return shuffle(rest).slice(0, OFFER_COUNT);

  const guaranteed = shuffle(skillCards)[0];
  const others = shuffle(rest).slice(0, OFFER_COUNT - 1);
  return shuffle([guaranteed, ...others]);
}

/**
 * カードを1枚取る。
 *
 * 効果はその場で能力値に足し込む。`perks` には何を取ったかだけ残す。
 * スキルの威力や待ち時間のように、使うたびに参照するものは
 * `perks` を数えて求める（skills.ts）。
 */
export function takePerk(state: GameState, actor: Actor, perkId: PerkId): boolean {
  if (actor.pendingLevels <= 0) return false;
  if (!actor.offers.includes(perkId)) return false;
  if (perkCount(actor.perks, perkId) >= PERKS[perkId].maxStacks) return false;

  actor.perks.push(perkId);
  actor.pendingLevels -= 1;
  actor.offers = [];

  // わざを覚えるカード
  const learn = perkOf(perkId).learn;
  if (learn !== undefined && !actor.skills.includes(learn)) {
    actor.skills.push(learn);
  }

  switch (perkId) {
    case 'vitality':
      actor.maxHp += 8;
      actor.hp += 8;
      break;
    case 'power':
      actor.atk += 2;
      break;
    case 'guard':
      actor.def += 1;
      break;
    case 'torch':
      actor.fuel += 80;
      break;
    case 'surge':
      actor.maxHp += 4;
      actor.hp = actor.maxHp;
      break;
    // swift / focus / mend は能力値ではなく、使うときに perks を数えて効く。
    // learn_* は上でわざを足しているので、ここですることは無い
    default:
      break;
  }

  pushLog(state, `${actor.slot}番は「${perkOf(perkId).name}」を選んだ`);

  // まだ溜まっていれば、続けて次の3枚を出す
  if (actor.pendingLevels > 0) actor.offers = rollOffers(actor);
  return true;
}

/** 敵を倒したときの吸命。combat.ts から呼ぶ */
export function applyMend(state: GameState, killer: Actor): void {
  const stacks = perkCount(killer.perks, 'mend');
  if (stacks === 0) return;
  if (!killer.alive) return;
  if (killer.hp >= killer.maxHp) return;

  killer.hp = Math.min(killer.maxHp, killer.hp + stacks * 2);
  pushLog(state, `${killer.slot}番は敵の力を吸い取った`);
}
