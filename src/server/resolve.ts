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
import { monsterAct } from './ai';
import { attack } from './combat';
import { applyItem } from './effects';
import { MAX_INVENTORY, descend, inventoryOf, pushLog } from './game';
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
  const players = state.actors.filter((a) => a.kind === 'player' && a.alive);
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

  // c. 死亡の片付けと勝敗判定
  cleanUpDead(state);
  checkGameOver(state);

  // d. 視界の更新
  updateVision(state);

  state.turn += 1;
}

function applyPlayerIntent(state: GameState, actorId: string, intent: Intent): void {
  const actor = state.actors.find((a) => a.id === actorId);
  if (!actor) return;

  switch (intent.type) {
    case 'wait':
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
        attack(state, actor, blocker, { pvp: false });
        return;
      }

      actor.pos = { x: nx, y: ny };

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
      if (inventoryOf(state, actor.id).length >= MAX_INVENTORY) {
        pushLog(state, 'これ以上持てない');
        return;
      }
      item.pos = null;
      item.ownerId = actor.id;
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

    case 'descend': {
      if (tileAt(state.floor, actor.pos.x, actor.pos.y) !== 'stairs') {
        pushLog(state, 'ここに階段はない');
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

  if (inventoryOf(state, actor.id).length >= MAX_INVENTORY) {
    pushLog(state, `${itemDefOf(item.itemId).name}があるが、持ちきれない`);
    return;
  }

  item.pos = null;
  item.ownerId = actor.id;
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
      item.ownerId = null;
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
