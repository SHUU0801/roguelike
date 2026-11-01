import { itemDefOf } from '../shared/items';
import {
  FUEL_REFILL,
  effectiveDef,
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

// 剣と盾の数値は shared/items.ts の equip に移した（袋に入れている間だけ効く）

/**
 * アイテムを使う。使ったアイテムは消える。
 *
 * **剣と盾はここに来ない。** 袋に入れている間だけ効く装備にした
 * （shared/items.ts の equip）。
 * 以前は「使う」と消えて能力が上がりっぱなしで、
 * 使った瞬間に袋が空くので**持っているほうが損**だった。
 * 装備欄は作らない。袋そのものが装備欄になっている。
 */
export function applyItem(state: GameState, actor: Actor, item: ItemInstance): void {
  const def = itemDefOf(item.itemId);

  // 装備は使えない。袋に入れていることが効果そのもの
  if (def.equip) {
    pushLog(state, `${def.name}は身に着けているだけで効いている`);
    return;
  }

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
        damage(state, target, Math.max(1, BOMB_DAMAGE - effectiveDef(state, target)));
      }
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
