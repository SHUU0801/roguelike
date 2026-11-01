import { fireballDamage, healAmount, jobOf } from '../shared/jobs';
import { perkCount } from '../shared/perks';
import {
  DIR_DELTA,
  actorAt,
  isHostile,
  tileAt,
  type Actor,
  type Dir,
  type GameState,
} from '../shared/types';
import { attack, damage } from './combat';
import { pushLog } from './game';

/**
 * 職業スキル。職業ごとに1つだけ。
 *
 * 守っている約束:
 *
 *   - **乱数を使わない。** ダメージ計算と同じ理由（combat.ts）。
 *     対戦に持っていくとき、ここを書き直さずに済む
 *   - **狙う相手を選ばせない。** 対象の指定 UI を作るとスマホで操作が重くなる。
 *     向きの決まった順（北→東→南→西）で自動的に決める。
 *     決まり方が一定なら、慣れた人は位置取りで狙う相手を操作できる
 *   - 1ターンぶんの行動。使ったら移動も攻撃もできない
 */

const SCAN: Dir[] = ['n', 'e', 's', 'w'];

/** スキルの待ち時間。「早業」を取っているぶん短くなる */
export function cooldownOf(actor: Actor): number {
  const base = jobOf(actor.job).skill.cooldown;
  return Math.max(1, base - perkCount(actor.perks, 'swift'));
}

/** 「極め」を取っているぶんの上乗せ */
function focusBonus(actor: Actor): number {
  return perkCount(actor.perks, 'focus') * 4;
}

export function skillReady(state: GameState, actor: Actor): boolean {
  return state.turn >= actor.skillReadyAt;
}

/**
 * スキルを使う。使えなかったら false を返す。
 * 使えたかどうかで待ち時間を進めるかが変わるので、呼び出し側に返す。
 */
export function useSkill(state: GameState, actor: Actor): boolean {
  if (!actor.alive) return false;
  if (!skillReady(state, actor)) {
    const left = actor.skillReadyAt - state.turn;
    pushLog(state, `まだ使えない（あと ${left} ターン）`);
    return false;
  }

  const job = jobOf(actor.job);
  const used = run(state, actor);
  if (!used) return false;

  actor.skillReadyAt = state.turn + cooldownOf(actor) + 1;
  pushLog(state, `${actor.slot}番の${job.skill.name}`);
  return true;
}

function run(state: GameState, actor: Actor): boolean {
  switch (actor.job) {
    case 'rogue':
      return backstab(state, actor);
    case 'mage':
      return fireball(state, actor);
    case 'cleric':
      return healLight(state, actor);
    case 'warrior':
    default:
      return cleave(state, actor);
  }
}

/** 戦士: 隣にいる敵すべてを通常攻撃 */
function cleave(state: GameState, actor: Actor): boolean {
  const targets = adjacentFoes(state, actor);
  if (targets.length === 0) {
    pushLog(state, '隣に敵がいない');
    return false;
  }
  const bonus = focusBonus(actor);
  for (const target of targets) {
    if (!target.alive) continue;
    attack(state, actor, target, { pvp: false });
    // 「極め」のぶんは通常攻撃とは別に足す。
    // atk を直接いじると、スキル以外の殴りまで強くなってしまう
    if (bonus > 0 && target.alive) damage(state, target, bonus, actor);
  }
  return true;
}

/** 盗賊: 隣の敵1体に、防御を無視した攻撃力ぶんのダメージ */
function backstab(state: GameState, actor: Actor): boolean {
  const target = adjacentFoes(state, actor)[0];
  if (!target) {
    pushLog(state, '隣に敵がいない');
    return false;
  }
  // 防御を無視するのがこのスキルの存在理由。
  // スライム（防御3）のような「殴ってもほとんど減らない敵」の答えになる
  damage(state, target, actor.atk + focusBonus(actor), actor);
  return true;
}

/** 魔法使い: 同じ列か行の、壁に遮られていない一番近い敵を撃つ */
function fireball(state: GameState, actor: Actor): boolean {
  const target = nearestInLine(state, actor);
  if (!target) {
    pushLog(state, '狙える敵がいない');
    return false;
  }
  damage(state, target, fireballDamage(actor.level) + focusBonus(actor), actor);
  return true;
}

/** 僧侶: 自分と、隣にいる仲間を回復 */
function healLight(state: GameState, actor: Actor): boolean {
  const amount = healAmount(actor.level) + focusBonus(actor);

  const targets = [actor, ...adjacentAllies(state, actor)];
  const healed = targets.filter((t) => t.alive && t.hp < t.maxHp);
  if (healed.length === 0) {
    pushLog(state, '誰も傷ついていない');
    return false;
  }
  for (const target of healed) {
    target.hp = Math.min(target.maxHp, target.hp + amount);
  }
  pushLog(state, `${healed.length}人の傷がふさがった（+${amount}）`);
  return true;
}

/** 北→東→南→西の順。順番を決めておけば、位置取りで狙う相手を操作できる */
function adjacentFoes(state: GameState, actor: Actor): Actor[] {
  const found: Actor[] = [];
  for (const dir of SCAN) {
    const d = DIR_DELTA[dir];
    const other = actorAt(state, actor.pos.x + d.x, actor.pos.y + d.y);
    if (other && isHostile(actor, other)) found.push(other);
  }
  return found;
}

function adjacentAllies(state: GameState, actor: Actor): Actor[] {
  const found: Actor[] = [];
  for (const dir of SCAN) {
    const d = DIR_DELTA[dir];
    const other = actorAt(state, actor.pos.x + d.x, actor.pos.y + d.y);
    if (other && other.kind === 'player' && !isHostile(actor, other)) found.push(other);
  }
  return found;
}

/** 4方向に伸ばして、壁に当たるまでの間にいる最初の敵 */
function nearestInLine(state: GameState, actor: Actor): Actor | undefined {
  let best: Actor | undefined;
  let bestDist = Infinity;

  for (const dir of SCAN) {
    const d = DIR_DELTA[dir];
    for (let step = 1; step <= 8; step++) {
      const x = actor.pos.x + d.x * step;
      const y = actor.pos.y + d.y * step;
      if (tileAt(state.floor, x, y) === 'wall') break;

      const other = actorAt(state, x, y);
      if (!other) continue;
      // 仲間が射線に入っていたら、その先は撃てない。誤射はさせない
      if (!isHostile(actor, other)) break;
      if (step < bestDist) {
        best = other;
        bestDist = step;
      }
      break;
    }
  }
  return best;
}
