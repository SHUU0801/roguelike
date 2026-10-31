import { itemDefOf } from '../shared/items';
import {
  DIR_DELTA,
  actorAt,
  itemAt,
  tileAt,
  type Actor,
  type GameState,
  type Intent,
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
  for (const actor of state.actors) {
    if (actor.kind !== 'player' || !actor.alive) continue;
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
        // 体当たり攻撃。仲間には当たらない（v1 の協力プレイでも同じ）
        if (blocker.kind === actor.kind) {
          pushLog(state, '仲間がいる');
          return;
        }
        attack(state, actor, blocker, { pvp: false });
        return;
      }

      actor.pos = { x: nx, y: ny };
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

/** 倒れたモンスターを盤から消す。プレイヤーは残す（死体の位置が意味を持つので） */
function cleanUpDead(state: GameState): void {
  const dead = state.actors.filter((a) => !a.alive && a.kind === 'monster');
  if (dead.length === 0) return;

  const deadIds = new Set(dead.map((a) => a.id));
  state.actors = state.actors.filter((a) => !deadIds.has(a.id));
  state.items = state.items.filter((i) => !(i.ownerId && deadIds.has(i.ownerId)));
}

function checkGameOver(state: GameState): void {
  const players: Actor[] = state.actors.filter((a) => a.kind === 'player');
  if (players.length === 0) return;
  if (players.every((p) => !p.alive)) {
    state.phase = 'lost';
  }
}
