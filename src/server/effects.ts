import { itemDefOf } from '../shared/items';
import { isHostile, type Actor, type GameState, type ItemInstance } from '../shared/types';
import { damage } from './combat';
import { randomFloorPos } from './dungeon';
import { pushLog } from './game';

const BOMB_DAMAGE = 10;
const POTION_HEAL = 10;

// 剣と盾に正負を付ける（03_改善構成.md §1-4）。
// デメリットが1つ付くだけで「拾ったら使う」が「今どっちが要るか」に変わる。
// 装備欄を作らずに済むので、スマホの画面を1ピクセルも増やさない。
const SWORD_ATK = 4;
const SWORD_DEF_COST = 1;
const SHIELD_DEF = 3;
const SHIELD_HP = 4;
const SHIELD_ATK_COST = 1;

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
      // 仲間には当たらない。以前は kind を見ておらず、唯一の味方撃ちの穴だった
      // （02_v1設計.md §4「仲間同士では殴れない」と矛盾していた）
      const targets = state.actors.filter(
        (a) =>
          a.alive &&
          a.id !== actor.id &&
          isHostile(actor, a) &&
          Math.abs(a.pos.x - actor.pos.x) <= 1 &&
          Math.abs(a.pos.y - actor.pos.y) <= 1,
      );
      if (targets.length === 0) {
        pushLog(state, '爆発したが、誰もいなかった');
      }
      for (const target of targets) {
        // 防御力を効かせる。以前は固定ダメージで、盾を積む意味が無かった。
        // 乱数は入れないので対戦でもそのまま使える（pvpSafe: true）
        damage(state, target, Math.max(1, BOMB_DAMAGE - target.def));
      }
      break;
    }

    case 'sword': {
      actor.atk += SWORD_ATK;
      actor.def = Math.max(0, actor.def - SWORD_DEF_COST);
      pushLog(state, `攻撃力 +${SWORD_ATK}、防御力 -${SWORD_DEF_COST}`);
      break;
    }

    case 'shield': {
      actor.def += SHIELD_DEF;
      actor.maxHp += SHIELD_HP;
      actor.hp += SHIELD_HP;
      actor.atk = Math.max(1, actor.atk - SHIELD_ATK_COST);
      pushLog(state, `防御力 +${SHIELD_DEF}、最大HP +${SHIELD_HP}、攻撃力 -${SHIELD_ATK_COST}`);
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
