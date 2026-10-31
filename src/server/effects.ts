import { itemDefOf } from '../shared/items';
import {
  FUEL_REFILL,
  isHostile,
  tileAt,
  type Actor,
  type GameState,
  type ItemInstance,
  type Pos,
} from '../shared/types';
import { damage } from './combat';
import { randomFloorPos, stairsPos } from './dungeon';
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

    case 'torch': {
      actor.fuel += FUEL_REFILL;
      pushLog(state, `松明をつぎ足した（残り ${actor.fuel}）`);
      break;
    }

    case 'scroll': {
      // 「階段の隣へ飛ぶ」に変えた。
      // 以前はランダムな床（しかも部屋の中だけ）に飛ぶので、
      // 敵の群れの真ん中に落ちることがあり、ほぼ純粋な損失アイテムだった。
      // 行き先が決まっているので効果が確定し、対戦でも使える（pvpSafe: true）。
      // 松明が尽きかけたときの「切り上げる」手段になる。
      const to = besideStairs(state) ?? randomFloorPos(state.floor, [actor.pos]);
      if (!to) {
        pushLog(state, '何も起きなかった');
        break;
      }
      actor.pos = to;
      pushLog(state, '階段のそばへ飛ばされた');
      break;
    }

    default:
      pushLog(state, '何も起きなかった');
      break;
  }

  // 使ったら消える
  state.items = state.items.filter((i) => i.id !== item.id);
}

/** 階段の隣の空きマス。階段そのものには乗せない（降りるかどうかは本人に選ばせる） */
function besideStairs(state: GameState): Pos | undefined {
  const stairs = stairsPos(state.floor);
  if (!stairs) return undefined;

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = stairs.x + dx;
    const y = stairs.y + dy;
    if (tileAt(state.floor, x, y) === 'wall') continue;
    if (state.actors.some((a) => a.alive && a.pos.x === x && a.pos.y === y)) continue;
    return { x, y };
  }
  return stairs;
}
