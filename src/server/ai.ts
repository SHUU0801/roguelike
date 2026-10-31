import {
  DIR_DELTA,
  actorAt,
  roomAt,
  tileAt,
  type Actor,
  type Dir,
  type GameState,
  type Pos,
} from '../shared/types';
import { attack } from './combat';
import { pick, randInt } from './random';

/**
 * モンスターの思考。v0 はこれだけ:
 *   プレイヤーが見えている → 近づく。隣なら殴る
 *   見えていない           → たまにうろつく
 *
 * 「見えている」の条件はプレイヤーの視界と同じ考え方にする（vision.ts と対になる）。
 * 同じ部屋にいるか、1マス以内にいるか。こうしておくと
 * 「こっちから見えている敵は、向こうからも見えている」が成り立って理不尽が減る。
 */
export function monsterAct(state: GameState, monster: Actor): void {
  const target = visibleTarget(state, monster);

  if (!target) {
    wander(state, monster);
    return;
  }

  // 移動は上下左右だけなので、攻撃も縦横に隣接しているときだけ
  if (manhattan(monster.pos, target.pos) === 1) {
    attack(state, monster, target, { pvp: false });
    return;
  }

  stepToward(state, monster, target.pos);
}

/** 見えているプレイヤーのうち、いちばん近い相手 */
function visibleTarget(state: GameState, monster: Actor): Actor | undefined {
  const players = state.actors.filter(
    (a) => a.kind === 'player' && a.alive && canSee(state, monster.pos, a.pos),
  );
  if (players.length === 0) return undefined;

  return players.reduce((closest, p) =>
    manhattan(monster.pos, p.pos) < manhattan(monster.pos, closest.pos) ? p : closest,
  );
}

function canSee(state: GameState, from: Pos, to: Pos): boolean {
  if (chebyshev(from, to) <= 1) return true;

  const roomA = roomAt(state.floor, from.x, from.y);
  const roomB = roomAt(state.floor, to.x, to.y);
  return roomA !== undefined && roomA === roomB;
}

/** 差の大きい軸から順に1歩進もうとする。塞がれていたらもう片方の軸 */
function stepToward(state: GameState, actor: Actor, to: Pos): void {
  const dx = to.x - actor.pos.x;
  const dy = to.y - actor.pos.y;

  const horizontal: Dir | null = dx === 0 ? null : dx > 0 ? 'e' : 'w';
  const vertical: Dir | null = dy === 0 ? null : dy > 0 ? 's' : 'n';

  const order =
    Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];

  for (const dir of order) {
    if (dir && tryMove(state, actor, dir)) return;
  }
}

function wander(state: GameState, actor: Actor): void {
  if (randInt(0, 1) === 0) return; // 半分はその場に留まる
  const dir = pick(['n', 's', 'e', 'w'] as const);
  if (dir) tryMove(state, actor, dir);
}

/** 動けたら true。壁と他の Actor には入れない */
function tryMove(state: GameState, actor: Actor, dir: Dir): boolean {
  const delta = DIR_DELTA[dir];
  const nx = actor.pos.x + delta.x;
  const ny = actor.pos.y + delta.y;

  if (tileAt(state.floor, nx, ny) === 'wall') return false;
  if (actorAt(state, nx, ny)) return false;

  actor.pos = { x: nx, y: ny };
  return true;
}

function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
