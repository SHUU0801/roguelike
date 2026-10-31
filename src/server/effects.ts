import { itemDefOf } from '../shared/items';
import type { Actor, GameState, ItemInstance } from '../shared/types';
import { damage } from './combat';
import { randomFloorPos } from './dungeon';
import { pushLog } from './game';

const BOMB_DAMAGE = 8;
const POTION_HEAL = 10;
const SWORD_ATK = 3;
const SHIELD_DEF = 2;

/**
 * アイテムを使う。使ったアイテムは消える。
 *
 * 剣と盾は「装備」ではなく、使うと能力が上がりっぱなしになる形にした。
 * 装備欄を作るとスマホの画面にもう1階層必要になるので、v0 では持たない。
 */
export function applyItem(state: GameState, actor: Actor, item: ItemInstance): void {
  const def = itemDefOf(item.itemId);
  pushLog(state, `${def.name}を使った`);

  switch (item.itemId) {
    case 'potion': {
      const healed = Math.min(POTION_HEAL, actor.maxHp - actor.hp);
      actor.hp += healed;
      pushLog(state, healed > 0 ? `HP が ${healed} 回復した` : 'HP は満タンだ');
      break;
    }

    case 'bomb': {
      const targets = state.actors.filter(
        (a) =>
          a.alive &&
          a.id !== actor.id &&
          Math.abs(a.pos.x - actor.pos.x) <= 1 &&
          Math.abs(a.pos.y - actor.pos.y) <= 1,
      );
      if (targets.length === 0) {
        pushLog(state, '爆発したが、誰もいなかった');
      }
      for (const target of targets) {
        damage(state, target, BOMB_DAMAGE);
      }
      break;
    }

    case 'sword': {
      actor.atk += SWORD_ATK;
      pushLog(state, `攻撃力が ${SWORD_ATK} 上がった`);
      break;
    }

    case 'shield': {
      actor.def += SHIELD_DEF;
      pushLog(state, `防御力が ${SHIELD_DEF} 上がった`);
      break;
    }

    case 'scroll': {
      // pvpSafe: false のアイテム。v1.5 の対戦では効果を確定化するか、外す
      const to = randomFloorPos(state.floor, [actor.pos]);
      if (!to) {
        pushLog(state, '何も起きなかった');
        break;
      }
      actor.pos = to;
      pushLog(state, 'どこかへ飛ばされた');
      break;
    }

    default:
      pushLog(state, '何も起きなかった');
      break;
  }

  // 使ったら消える
  state.items = state.items.filter((i) => i.id !== item.id);
}
