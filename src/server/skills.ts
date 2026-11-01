import { healAmount, jobOf } from '../shared/jobs';
import { perkCount } from '../shared/perks';
import {
  BLESS_BONUS,
  GUARD_BONUS,
  SKILLS,
  skillOf,
  type SkillId,
} from '../shared/skills';
import {
  DIR_DELTA,
  actorAt,
  addEffect,
  effectiveAtk,
  hasEffect,
  isHostile,
  tileAt,
  type Actor,
  type Dir,
  type GameState,
} from '../shared/types';
import { attack, damage } from './combat';
import { pushLog } from './game';

/**
 * わざの効果。定義（名前・説明・待ち時間）は shared/skills.ts。
 *
 * 約束は shared/skills.ts の頭に書いたとおり。乱数なし、対象指定なし、
 * 空振りしたら待ち時間を使わない。
 */

const SCAN: Dir[] = ['n', 'e', 's', 'w'];

/** そのわざの待ち時間。「早業」を取っているぶん短くなる */
export function cooldownOf(actor: Actor, skillId: SkillId): number {
  return Math.max(1, SKILLS[skillId].cooldown - perkCount(actor.perks, 'swift'));
}

/** 「極め」を取っているぶんの上乗せ */
function focusBonus(actor: Actor): number {
  return perkCount(actor.perks, 'focus') * 4;
}

export function skillReady(state: GameState, actor: Actor, skillId: SkillId): boolean {
  const until = actor.cooldowns[skillId];
  return until === undefined || state.turn >= until;
}

/** 魔法の威力。レベルで伸びる。atk が 1 しか伸びない職業の伸びをここに集めている */
function spellPower(actor: Actor): number {
  return 6 + actor.level * 2 + focusBonus(actor);
}

/**
 * わざを使う。使えなかったら false。
 * 使えたかどうかで待ち時間を進めるかが変わるので、呼び出し側に返す。
 */
export function useSkill(state: GameState, actor: Actor, skillId: SkillId): boolean {
  if (!actor.alive) return false;
  if (!actor.skills.includes(skillId)) {
    pushLog(state, 'そのわざは覚えていない');
    return false;
  }
  if (!skillReady(state, actor, skillId)) {
    const left = (actor.cooldowns[skillId] ?? 0) - state.turn;
    pushLog(state, `まだ使えない（あと ${left} ターン）`);
    return false;
  }

  if (!run(state, actor, skillId)) return false;

  actor.cooldowns[skillId] = state.turn + cooldownOf(actor, skillId) + 1;
  pushLog(state, `${actor.slot}番の${skillOf(skillId).name}`);
  return true;
}

function run(state: GameState, actor: Actor, skillId: SkillId): boolean {
  switch (skillId) {
    case 'cleave':
      return cleave(state, actor);
    case 'taunt':
      return taunt(state, actor);
    case 'bulwark':
      return selfGuard(state, actor);
    case 'backstab':
      return backstab(state, actor);
    case 'vanish':
      return vanish(state, actor);
    case 'venom':
      return venom(state, actor);
    case 'fireball':
      return fireball(state, actor);
    case 'bolt':
      return bolt(state, actor);
    case 'frost':
      return frost(state, actor);
    case 'heal':
      return healLight(state, actor);
    case 'bless':
      return bless(state, actor);
    case 'smite':
      return smite(state, actor);
  }
}

// --- 戦士 ---

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
    // 「極め」のぶんは別に足す。atk を直接いじると通常の殴りまで強くなる
    if (bonus > 0 && target.alive) damage(state, target, bonus, actor);
  }
  return true;
}

/**
 * 挑発。周りの敵をこちらに向かせて、気づかせる。
 *
 * 気づかせるのが「弱体化」ではないのが要点。
 * 盗賊が背後に回り込むまでの間、敵の注意を引き受ける役になれる。
 */
function taunt(state: GameState, actor: Actor): boolean {
  const seen = foesWithin(state, actor, 5);
  if (seen.length === 0) {
    pushLog(state, '近くに敵がいない');
    return false;
  }
  for (const foe of seen) {
    foe.aware = true;
    foe.facing = towardDir(foe, actor);
  }
  addEffect(actor, 'guard', state.turn, 3);
  pushLog(state, `${seen.length}体の注意を引きつけた（防御 +${GUARD_BONUS}）`);
  return true;
}

function selfGuard(state: GameState, actor: Actor): boolean {
  addEffect(actor, 'bulwark', state.turn, 4);
  pushLog(state, '盾を構えた（受けるダメージが半分）');
  return true;
}

// --- 盗賊 ---

function backstab(state: GameState, actor: Actor): boolean {
  const target = adjacentFoes(state, actor)[0];
  if (!target) {
    pushLog(state, '隣に敵がいない');
    return false;
  }
  // 防御を無視するのがこのわざの存在理由。
  // スライム（防御3）のような「殴ってもほとんど減らない敵」の答えになる
  damage(state, target, effectiveAtk(state, actor) + focusBonus(actor), actor);
  return true;
}

function vanish(state: GameState, actor: Actor): boolean {
  addEffect(actor, 'hidden', state.turn, 4);
  // 今追ってきている敵にも見失わせる。でないと「隠れたのに追ってくる」になる
  for (const foe of state.actors) {
    if (foe.kind !== 'monster' || !foe.alive) continue;
    if (manhattan(foe.pos, actor.pos) <= 6) foe.aware = false;
  }
  pushLog(state, '気配を消した');
  return true;
}

function venom(state: GameState, actor: Actor): boolean {
  const target = adjacentFoes(state, actor)[0];
  if (!target) {
    pushLog(state, '隣に敵がいない');
    return false;
  }
  addEffect(target, 'poison', state.turn, 5);
  pushLog(state, '毒が回り始めた');
  return true;
}

// --- 魔法使い ---

function fireball(state: GameState, actor: Actor): boolean {
  const target = nearestInLine(state, actor);
  if (!target) {
    pushLog(state, '狙える敵がいない');
    return false;
  }
  damage(state, target, spellPower(actor), actor);
  return true;
}

/** いなずま: 一番敵の多い方向へ撃ち、その線上を全部貫く */
function bolt(state: GameState, actor: Actor): boolean {
  let bestDir: Dir | null = null;
  let bestHits: Actor[] = [];

  for (const dir of SCAN) {
    const hits = lineOfFoes(state, actor, dir);
    if (hits.length > bestHits.length) {
      bestHits = hits;
      bestDir = dir;
    }
  }
  if (!bestDir || bestHits.length === 0) {
    pushLog(state, '狙える敵がいない');
    return false;
  }
  // 貫くぶん1体あたりは控えめ
  const power = Math.max(1, spellPower(actor) - 2);
  for (const target of bestHits) {
    if (target.alive) damage(state, target, power, actor);
  }
  return true;
}

function frost(state: GameState, actor: Actor): boolean {
  const target = nearestInLine(state, actor);
  if (!target) {
    pushLog(state, '狙える敵がいない');
    return false;
  }
  addEffect(target, 'stun', state.turn, 3);
  pushLog(state, '凍りついて動けなくなった');
  return true;
}

// --- 僧侶 ---

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

function bless(state: GameState, actor: Actor): boolean {
  const targets = [actor, ...adjacentAllies(state, actor)].filter((t) => t.alive);
  for (const target of targets) {
    addEffect(target, 'guard', state.turn, 4);
  }
  pushLog(state, `${targets.length}人の防御が上がった（+${BLESS_BONUS}）`);
  return true;
}

function smite(state: GameState, actor: Actor): boolean {
  const target = adjacentFoes(state, actor)[0];
  if (!target) {
    pushLog(state, '隣に敵がいない');
    return false;
  }
  damage(state, target, spellPower(actor), actor);
  if (target.alive) {
    addEffect(target, 'stun', state.turn, 1);
    pushLog(state, 'ひるんでいる');
  }
  return true;
}

// --- 共通 ---

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

function foesWithin(state: GameState, actor: Actor, range: number): Actor[] {
  return state.actors.filter(
    (a) => a.alive && isHostile(actor, a) && manhattan(a.pos, actor.pos) <= range,
  );
}

/** 4方向に伸ばして、壁に当たるまでの間にいる最初の敵 */
function nearestInLine(state: GameState, actor: Actor): Actor | undefined {
  let best: Actor | undefined;
  let bestDist = Infinity;

  for (const dir of SCAN) {
    const hits = lineOfFoes(state, actor, dir);
    const first = hits[0];
    if (!first) continue;
    const d = manhattan(first.pos, actor.pos);
    if (d < bestDist) {
      best = first;
      bestDist = d;
    }
  }
  return best;
}

/** その方向の直線上にいる敵。壁で止まる。仲間が射線に入ったらそこで止める */
function lineOfFoes(state: GameState, actor: Actor, dir: Dir): Actor[] {
  const d = DIR_DELTA[dir];
  const found: Actor[] = [];

  for (let step = 1; step <= 8; step++) {
    const x = actor.pos.x + d.x * step;
    const y = actor.pos.y + d.y * step;
    if (tileAt(state.floor, x, y) === 'wall') break;

    const other = actorAt(state, x, y);
    if (!other) continue;
    // 仲間が射線に入っていたら、その先は撃てない。誤射はさせない
    if (!isHostile(actor, other)) break;
    found.push(other);
  }
  return found;
}

function towardDir(from: Actor, to: Actor): Dir {
  const dx = to.pos.x - from.pos.x;
  const dy = to.pos.y - from.pos.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 毒・凍結などの持続処理。resolve.ts が毎ターン呼ぶ */
export function tickEffects(state: GameState): void {
  for (const actor of [...state.actors]) {
    if (!actor.alive) continue;
    if (hasEffect(actor, 'poison', state.turn)) {
      damage(state, actor, 3);
    }
  }
}
