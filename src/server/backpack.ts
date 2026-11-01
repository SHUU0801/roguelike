import { itemDefOf, rotated, shapeSize } from '../shared/items';
import {
  BAG_H,
  BAG_W,
  type GameState,
  type ItemInstance,
  type Pos,
} from '../shared/types';

/**
 * バックパック。
 *
 * 「6個まで」という数の制限をやめて、形で詰める形にした。
 * 数だけだと薬草6個と剣6本が同じ重さになる。形があると
 * 「剣は縦3マス食うから、もう1本は諦めて薬草を入れる」という判断が生まれる。
 *
 * **配置はサーバーが持つ**（ItemInstance.at / rot）。
 * クライアントに置かせると、重ねて置いて無限に持ててしまう。
 * 並べ替えはターンの行動ではない（GameRoom の 'rearrange'）。
 * 1マス動かすたびに1手使うのでは、詰め直す気にならない。
 */

/** そのアイテムが占めるマス。向きを反映した絶対座標 */
export function cellsOf(item: ItemInstance): Pos[] {
  if (!item.at) return [];
  const shape = rotated(itemDefOf(item.itemId).shape, item.rot);
  return shape.map(([dx, dy]) => ({ x: item.at!.x + dx, y: item.at!.y + dy }));
}

/** 誰かの持ち物 */
export function carriedBy(state: GameState, ownerId: string): ItemInstance[] {
  return state.items.filter((i) => i.ownerId === ownerId && i.at !== null);
}

/**
 * その位置に置けるか。
 * `ignoreId` は自分自身（動かしている最中のもの）を当たり判定から外すため。
 */
export function canPlace(
  state: GameState,
  ownerId: string,
  itemId: string,
  at: Pos,
  rot: number,
  ignoreId?: string,
): boolean {
  const shape = rotated(itemDefOf(itemId).shape, rot);

  const taken = new Set<string>();
  for (const other of carriedBy(state, ownerId)) {
    if (other.id === ignoreId) continue;
    for (const c of cellsOf(other)) taken.add(`${c.x},${c.y}`);
  }

  for (const [dx, dy] of shape) {
    const x = at.x + dx;
    const y = at.y + dy;
    if (x < 0 || y < 0 || x >= BAG_W || y >= BAG_H) return false;
    if (taken.has(`${x},${y}`)) return false;
  }
  return true;
}

/**
 * 空いている場所を探す。見つからなければ null。
 *
 * 左上から順に、まずそのままの向きで、だめなら90度回して試す。
 * 探し方を決めておけば、同じ状況なら必ず同じ場所に入る。
 * 拾うたびに置き場所が変わると、持ち物の見た目が毎回変わって読めなくなる。
 */
export function findFit(
  state: GameState,
  ownerId: string,
  itemId: string,
): { at: Pos; rot: number } | null {
  const [w, h] = shapeSize(itemDefOf(itemId).shape);
  const rots = w === h ? [0] : [0, 1];

  for (const rot of rots) {
    for (let y = 0; y < BAG_H; y++) {
      for (let x = 0; x < BAG_W; x++) {
        if (canPlace(state, ownerId, itemId, { x, y }, rot)) {
          return { at: { x, y }, rot };
        }
      }
    }
  }
  return null;
}

/** 袋に入れる。入らなければ false */
export function putIn(state: GameState, ownerId: string, item: ItemInstance): boolean {
  const fit = findFit(state, ownerId, item.itemId);
  if (!fit) return false;

  item.ownerId = ownerId;
  item.pos = null;
  item.at = fit.at;
  item.rot = fit.rot;
  return true;
}

/** 袋から出す。床に置く・使う・落とすときに通る */
export function takeOut(item: ItemInstance): void {
  item.ownerId = null;
  item.at = null;
  item.rot = 0;
}

/**
 * 手で並べ替える。ターンの行動ではない。
 * 置けない場所を指定されたら何もしないで false。
 */
export function rearrange(
  state: GameState,
  ownerId: string,
  instanceId: string,
  at: Pos,
  rot: number,
): boolean {
  const item = state.items.find((i) => i.id === instanceId && i.ownerId === ownerId);
  if (!item || item.at === null) return false;
  if (!canPlace(state, ownerId, item.itemId, at, rot, item.id)) return false;

  item.at = { ...at };
  item.rot = rot % 2;
  return true;
}

/** 埋まっているマスの数。画面に「12/20」と出すのに使う */
export function usedCells(state: GameState, ownerId: string): number {
  return carriedBy(state, ownerId).reduce((n, i) => n + cellsOf(i).length, 0);
}
