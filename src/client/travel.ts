import {
  DIR_DELTA,
  tileAt,
  type Dir,
  type GameState,
  type Pos,
} from '../shared/types';

/**
 * 「遠いマスをタップしたら、そこまで歩く」ための道探し。
 *
 * ## なぜ入れたか
 *
 * ローグライクをタッチで遊ばせるときの定石で、
 * **キーボードの操作を画面に写すのではなく、タップ前提で作り直す**のが要点。
 * 隣のマスしか押せない作りだと、部屋の端まで行くのに十数回タップすることになる。
 * 参考にした議論は 08_参考にしたもの.md に書いた。
 *
 * ## これはゲームのルールではない
 *
 * ここでやっているのは「次にどの向きへ歩くか」を決めるだけで、
 * 実際に歩けるかどうかはサーバーが1手ずつ判定する（設計書 §1）。
 * クライアントで道を引いても、サーバーの権威は一切動かない。
 * 道が塞がっていたらサーバーが弾き、こちらは歩みを止める。
 *
 * ## 通れるとみなすマス
 *
 * **見たことがあるマス**だけ。見ていない場所へは引けない。
 * 引けてしまうと、まだ知らないはずの通路を知っていることになる。
 */

/** 幅優先で道を引く。着けないなら null */
export function findPath(state: GameState, from: Pos, to: Pos): Pos[] | null {
  const { floor } = state;
  const index = (p: Pos) => p.y * floor.width + p.x;

  const walkable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
    if (!floor.seen[y * floor.width + x]) return false;
    return tileAt(floor, x, y) !== 'wall';
  };

  // 他の Actor は通れない。ただし目的地にいる相手は通さない（殴る指示ではないので）
  const blocked = new Set(
    state.actors.filter((a) => a.alive).map((a) => index(a.pos)),
  );
  blocked.delete(index(from));

  if (!walkable(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return null;

  const prev = new Map<number, number | null>();
  const queue: Pos[] = [from];
  prev.set(index(from), null);
  let found = false;

  while (queue.length > 0) {
    const here = queue.shift();
    if (!here) break;
    if (here.x === to.x && here.y === to.y) {
      found = true;
      break;
    }
    for (const dir of ['n', 'e', 's', 'w'] as Dir[]) {
      const d = DIR_DELTA[dir];
      const next = { x: here.x + d.x, y: here.y + d.y };
      const key = index(next);
      if (!walkable(next.x, next.y)) continue;
      if (prev.has(key)) continue;
      // 目的地に誰か立っているときは、その手前で止める判断を呼び出し側に任せる
      if (blocked.has(key) && !(next.x === to.x && next.y === to.y)) continue;
      prev.set(key, index(here));
      queue.push(next);
    }
  }
  if (!found) return null;

  const path: Pos[] = [];
  let cursor: number | null = index(to);
  while (cursor !== null && cursor !== index(from)) {
    path.push({ x: cursor % floor.width, y: Math.floor(cursor / floor.width) });
    cursor = prev.get(cursor) ?? null;
  }
  path.reverse();
  return path.length > 0 ? path : null;
}

/** 隣のマスへの向き。隣でなければ null */
export function dirBetween(from: Pos, to: Pos): Dir | null {
  for (const dir of ['n', 'e', 's', 'w'] as Dir[]) {
    const d = DIR_DELTA[dir];
    if (from.x + d.x === to.x && from.y + d.y === to.y) return dir;
  }
  return null;
}

/**
 * 歩き続けてよいか。
 *
 * **止まる条件を広めに取る。** 自動で歩いている間に殴られるのが、
 * この手の操作で一番腹が立つところなので、少しでも怪しければ止める。
 *
 *   体力が減った
 *   気づいている敵が見えている
 *   目の前に誰かいる
 */
export function shouldStop(state: GameState, myId: string, hpBefore: number): boolean {
  const me = state.actors.find((a) => a.id === myId);
  if (!me || !me.alive) return true;
  if (me.hp < hpBefore) return true;

  const { floor } = state;
  return state.actors.some(
    (a) =>
      a.kind === 'monster' &&
      a.alive &&
      a.aware &&
      floor.visible[a.pos.y * floor.width + a.pos.x] === true,
  );
}
