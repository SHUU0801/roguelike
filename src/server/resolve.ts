import { itemDefOf } from '../shared/items';
import {
  DIR_DELTA,
  actorAt,
  isHostile,
  itemAt,
  tileAt,
  type Actor,
  type GameState,
  type Intent,
  type Pos,
} from '../shared/types';
import { FUEL_DANGER, FUEL_WARN, REVIVE_COST, hasEffect } from '../shared/types';
import { isSkillId } from '../shared/skills';
import { alertOnHit, monsterAct } from './ai';
import { attack, damage, sneakAttack } from './combat';
import { applyItem } from './effects';
import { descend, pushLog } from './game';
import { putIn, takeOut } from './backpack';
import { tickEffects, useSkill } from './skills';
import { updateVision } from './vision';

/**
 * 1ターンを解決する。
 *
 * 解決順は「プレイヤー全員 → モンスター全員」で固定（設計書 §5）。
 * ここを曖昧にすると、v1 で「誰の攻撃が先に入ったのか」で揉める。
 */
export function resolveTurn(state: GameState, intents: Map<string, Intent>): void {
  if (state.phase !== 'playing') return;

  const depthAtStart = state.floor.depth;

  // a. プレイヤーの行動
  //
  // 順番をターンごとに回す。以前は state.actors の並び（＝入室順）で
  // 固定だったので、最初に入った人が毎ターン必ず先に動いていた。
  // 同じマスを2人が狙うと先の人が入るので、目に見えない恒久的な有利だった。
  // 倒れた人も含める。死者は移動しかできないが、動けることで偵察役になれる
  const players = state.actors.filter((a) => a.kind === 'player');
  for (let i = 0; i < players.length; i++) {
    const actor = players[(i + state.turn) % players.length];
    const intent = intents.get(actor.id) ?? { type: 'wait' };
    applyPlayerIntent(state, actor.id, intent);
  }

  // 階段を降りるとフロアが作り直される。その場合このターンのモンスターは動かさない
  const descended = state.floor.depth !== depthAtStart;

  // b. モンスターの行動
  if (!descended) {
    for (const actor of [...state.actors]) {
      if (actor.kind !== 'monster' || !actor.alive) continue;
      monsterAct(state, actor);
    }
  }

  // c. 松明が燃える。時間そのものを資源にするのがこの1行の目的
  burnFuel(state);

  // c-2. 毒などの持続ダメージ
  tickEffects(state);

  // d. 死亡の片付けと勝敗判定
  cleanUpDead(state);
  checkGameOver(state);

  // e. 視界の更新
  updateVision(state);

  state.turn += 1;
}

/**
 * 松明を燃やす。
 *
 * これが入るまで、このゲームには時間のコストが存在しなかった。
 * 通路に1歩下がれば追跡は切れ、時間を使っても何も減らないので、
 * どの判断も「やらなくていい」で解決できてしまっていた。
 * 1ターン1だけ減らすこの処理で、既存の全ターンに意味が生まれる。
 */
function burnFuel(state: GameState): void {
  for (const actor of state.actors) {
    if (actor.kind !== 'player' || !actor.alive) continue;

    if (actor.fuel > 0) {
      actor.fuel -= 1;
      if (actor.fuel === FUEL_WARN) pushLog(state, '松明が心細くなってきた');
      else if (actor.fuel === FUEL_DANGER) pushLog(state, '松明が消えかけている');
      else if (actor.fuel === 0) pushLog(state, '松明が消えた…');
      continue;
    }

    // 消えている間は毎ターン傷つく。立ち止まっていても安全ではなくなる
    damage(state, actor, 1);
  }
}

function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function applyPlayerIntent(state: GameState, actorId: string, intent: Intent): void {
  const actor = state.actors.find((a) => a.id === actorId);
  if (!actor) return;

  // 凍結・ひるみ。わざで敵を止められる以上、対戦で自分も止まる形にしておく
  if (actor.alive && hasEffect(actor, 'stun', state.turn)) {
    pushLog(state, `${actor.slot}番は動けない`);
    return;
  }

  // 倒れた人は歩くことしかできない。
  // 完全な無入力にすると、最初の5分で死んだ人が25分ただ見ているだけになる。
  // 視界は生きている人と共有されるので、偵察役として仕事が残る。
  if (!actor.alive) {
    if (intent.type !== 'move') return;
    const delta = DIR_DELTA[intent.dir];
    const nx = actor.pos.x + delta.x;
    const ny = actor.pos.y + delta.y;
    if (tileAt(state.floor, nx, ny) === 'wall') return;
    actor.pos = { x: nx, y: ny };
    return;
  }

  switch (intent.type) {
    case 'wait':
      // 待機に意味を持たせる。松明を燃やして体力に換える取引になる。
      // 以前は押しても何も起きないボタンだった
      if (actor.hp < actor.maxHp) {
        actor.hp += 1;
        pushLog(state, '息を整えた');
      }
      return;

    case 'move': {
      const delta = DIR_DELTA[intent.dir];
      const nx = actor.pos.x + delta.x;
      const ny = actor.pos.y + delta.y;

      if (tileAt(state.floor, nx, ny) === 'wall') {
        pushLog(state, '壁だ');
        return;
      }

      const blocker = actorAt(state, nx, ny);
      if (blocker) {
        // 体当たり攻撃。敵味方の判定は team で行う（kind では判定しない）
        if (!isHostile(actor, blocker)) {
          pushLog(state, '仲間がいる');
          return;
        }
        // 気づいていない相手には不意打ち。倍のダメージを与え、
        // alertOnHit がその敵のこのターンの行動を奪う。
        // 「ぶつかったら必ず殴り返される」を無くすのがこの2行
        const unaware = blocker.kind === 'monster' && !blocker.aware;
        if (unaware) sneakAttack(state, actor, blocker);
        else attack(state, actor, blocker, { pvp: false });
        alertOnHit(state, blocker, actor.pos);
        return;
      }

      // 離脱ペナルティ。
      // 隣にいる敵から離れると、その敵が1回だけ無条件で殴る。
      // これが無いと「3発殴って不利だと分かったら無料で撤退」ができてしまい、
      // 戦闘を始めること自体が無リスクになる。退却に値段を付ける。
      // 気づいていない敵と、動けない敵は追撃してこない。
      // 寝ている敵の横をすり抜けられないと、忍び寄る意味が消える
      const leaving = state.actors.filter(
        (a) =>
          a.alive &&
          isHostile(actor, a) &&
          (a.kind !== 'monster' || a.aware) &&
          !hasEffect(a, 'stun', state.turn) &&
          manhattan(a.pos, actor.pos) === 1 &&
          manhattan(a.pos, { x: nx, y: ny }) > 1,
      );

      actor.pos = { x: nx, y: ny };

      for (const enemy of leaving) {
        if (!actor.alive) return;
        pushLog(state, '背を向けた隙を突かれた');
        attack(state, enemy, actor, { pvp: false });
      }
      if (!actor.alive) return;

      // 乗ったら拾う。
      // 拾うためだけに1ターン使うのは、判断ではなく税だった。
      // 持ちきれないときだけ床に残るので、「拾う」ボタンは残してある。
      autoPickUp(state, actor);
      return;
    }

    case 'pickUp': {
      const item = itemAt(state, actor.pos.x, actor.pos.y);
      if (!item) {
        pushLog(state, '足元には何もない');
        return;
      }
      if (!putIn(state, actor.id, item)) {
        pushLog(state, '袋に空きがない');
        return;
      }
      pushLog(state, `${itemDefOf(item.itemId).name}を拾った`);
      return;
    }

    case 'useItem': {
      const item = state.items.find(
        (i) => i.id === intent.instanceId && i.ownerId === actor.id,
      );
      if (!item) {
        pushLog(state, 'それは持っていない');
        return;
      }
      applyItem(state, actor, item);
      return;
    }

    case 'drop': {
      const item = state.items.find(
        (i) => i.id === intent.instanceId && i.ownerId === actor.id,
      );
      if (!item) {
        pushLog(state, 'それは持っていない');
        return;
      }
      // 1マスに2つ置くと itemAt が先頭しか返さないので、重ねさせない。
      // 制約だが「どこに置くか」という小さな相談にもなる
      if (itemAt(state, actor.pos.x, actor.pos.y)) {
        pushLog(state, 'ここには置けない');
        return;
      }
      takeOut(item);
      item.pos = { ...actor.pos };
      pushLog(state, `${itemDefOf(item.itemId).name}を置いた`);
      return;
    }

    case 'revive': {
      const fallen = state.actors.find(
        (a) =>
          a.kind === 'player' && !a.alive && manhattan(a.pos, actor.pos) === 1,
      );
      if (!fallen) {
        pushLog(state, '隣に倒れている仲間はいない');
        return;
      }
      // 代償は自分の耐久。アイテムを要求しない。
      // 「薬草を1個」にすると、薬草が出なかったランで蘇生が不可能になり、
      // 対戦で最も嫌う「運で負けた」を協力モードで作ってしまう。
      if (actor.maxHp <= REVIVE_COST + 1) {
        pushLog(state, 'これ以上は分けてやれない');
        return;
      }
      actor.maxHp -= REVIVE_COST;
      actor.hp = Math.min(actor.hp, actor.maxHp);
      fallen.alive = true;
      fallen.hp = 1;
      fallen.fuel = Math.max(fallen.fuel, 40);
      pushLog(
        state,
        `${actor.slot}番が ${fallen.slot}番を起こした（最大HP -${REVIVE_COST}）`,
      );
      return;
    }

    case 'skill': {
      if (!isSkillId(intent.skillId)) return;
      // 使えなかったときは待ち時間を進めない（skills.ts が false を返す）。
      // 「隣に敵がいないのに撃って、空振りのまま5ターン待つ」を作らないため
      useSkill(state, actor, intent.skillId);
      return;
    }

    case 'descend': {
      // 階段に誰か1人でも立っていれば、他の人は離れた場所からでも同意できる。
      // 全員を階段に集めさせると待ち時間が生まれるので、そうはしない
      const someoneOnStairs = state.actors.some(
        (a) =>
          a.kind === 'player' &&
          a.alive &&
          tileAt(state.floor, a.pos.x, a.pos.y) === 'stairs',
      );
      if (!someoneOnStairs) {
        pushLog(state, 'まだ誰も階段にいない');
        return;
      }

      if (!state.descendReady.includes(actor.id)) state.descendReady.push(actor.id);

      const alive = state.actors.filter((a) => a.kind === 'player' && a.alive);
      const ready = alive.filter((a) => state.descendReady.includes(a.id));
      if (ready.length < alive.length) {
        // 1人が踏むと全員が引きずられ、床のアイテムが無警告で消えていた事故の対策。
        // 「待って、まだ薬草拾ってない」が必ず言えるようになる
        pushLog(state, `降りる準備 ${ready.length}/${alive.length}`);
        return;
      }
      descend(state);
      return;
    }
  }
}

/** 足元のものを拾う。持ちきれなければ床に残す */
function autoPickUp(state: GameState, actor: Actor): void {
  const item = itemAt(state, actor.pos.x, actor.pos.y);
  if (!item) return;

  if (!putIn(state, actor.id, item)) {
    pushLog(state, `${itemDefOf(item.itemId).name}があるが、袋に空きがない`);
    return;
  }
  pushLog(state, `${itemDefOf(item.itemId).name}を拾った`);
}

/**
 * 倒れたものの後片付け。
 *
 * モンスターは盤から消す。プレイヤーは残す（死体の位置が意味を持つので）。
 * 倒れたプレイヤーの持ち物は床に落とす。
 * 以前は ownerId が死者のまま state に残り続け、誰も使えないまま
 * 次のフロアまで付いてきていた。落とせば仲間が取りに行ける。
 */
function cleanUpDead(state: GameState): void {
  for (const actor of state.actors) {
    if (actor.kind !== 'player' || actor.alive) continue;

    const carried = state.items.filter((i) => i.ownerId === actor.id);
    if (carried.length === 0) continue;

    for (const item of carried) {
      takeOut(item);
      item.pos = freeItemSpot(state, actor.pos);
    }
    pushLog(state, '持っていたものが床に散らばった');
  }

  const dead = state.actors.filter((a) => !a.alive && a.kind === 'monster');
  if (dead.length === 0) return;

  const deadIds = new Set(dead.map((a) => a.id));
  state.actors = state.actors.filter((a) => !deadIds.has(a.id));
  state.items = state.items.filter((i) => !(i.ownerId && deadIds.has(i.ownerId)));
}

/** アイテムを置ける近場のマス。itemAt は1マス1個しか返さないので重ねない */
function freeItemSpot(state: GameState, from: Pos): Pos {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = from.x + dx;
        const y = from.y + dy;
        if (tileAt(state.floor, x, y) === 'wall') continue;
        if (itemAt(state, x, y)) continue;
        return { x, y };
      }
    }
  }
  return { ...from };
}

function checkGameOver(state: GameState): void {
  const players: Actor[] = state.actors.filter((a) => a.kind === 'player');
  if (players.length === 0) return;
  if (players.every((p) => !p.alive)) {
    state.phase = 'lost';
  }
}
