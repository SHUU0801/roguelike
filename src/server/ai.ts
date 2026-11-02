import { speciesOf } from '../shared/monsters';
import {
  DIR_DELTA,
  actorAt,
  addEffect,
  hasEffect,
  isHostile,
  roomAt,
  tileAt,
  type Actor,
  type Dir,
  type GameState,
  type Pos,
} from '../shared/types';
import { attack } from './combat';
import { pushLog } from './game';
import { pick, randInt } from './random';

/**
 * モンスターの思考。
 *
 * ## 以前との違い
 *
 * v0 は「見えたら最短距離で突っ込む」だけだった。
 * そのせいで**忍び寄るという選択肢が存在しなかった**し、
 * 隣に行けば必ず殴り返されるので、戦うか戦わないかしか決められなかった。
 *
 * いまのモンスターは3つの状態を持つ。
 *
 *   気づいていない … 向いている方向をうろうろ見ている。背後は見えない
 *   気づいた瞬間   … その1ターンは動かない（「！」が出る）
 *   追っている     … 近づいて殴る（以前の動き）
 *
 * ## 向きと視界
 *
 * モンスターは `facing` を持ち、**正面側にいる相手しか見つけられない**。
 * 真横と背後は見えない。だから回り込めば通り抜けられるし、
 * 気づかれていない相手を殴ると不意打ちになる（resolve.ts）。
 *
 * 「こっちから見えている敵は、向こうからも見えている」という v0 の対称性は
 * 捨てた。代わりに**向きを画面に出す**ことで理不尽を防いでいる
 * （FloorView が三角で向きを、💤 と ❗ で状態を描く）。
 */

/**
 * 気づく距離。これ以上離れていると、正面にいても気づかない。
 *
 * 最初 6 にしたら、部屋を横切るだけでほぼ必ず見つかって、
 * 忍び寄りが一度も成立しなかった（実測）。フロアは 16〜20 マス四方なので、
 * 6 は部屋のほぼ全体に届いてしまう。
 */
const SIGHT = 4;

export function monsterAct(state: GameState, monster: Actor): void {
  // 凍結・ひるみ。不意打ちを受けた直後もここで1ターン止まる
  if (hasEffect(monster, 'stun', state.turn)) return;

  if (!monster.aware) {
    const spotted = spot(state, monster);
    if (spotted) {
      // 気づいた瞬間は動かない。
      // すぐ殴りかかってくると「気づかれた」が画面に出る前に結果だけが来る
      monster.aware = true;
      monster.facing = towardDir(monster.pos, spotted.pos);
      pushLog(state, `${speciesOf(monster.speciesId).name}がこちらに気づいた`);
      return;
    }
    patrol(state, monster);
    return;
  }

  const target = chaseTarget(state, monster);
  if (!target) {
    // 見失った。その場で周りを見る
    monster.aware = false;
    pushLog(state, `${speciesOf(monster.speciesId).name}は見失ったようだ`);
    patrol(state, monster);
    return;
  }

  monster.facing = towardDir(monster.pos, target.pos);

  // 移動は上下左右だけなので、攻撃も縦横に隣接しているときだけ
  if (manhattan(monster.pos, target.pos) === 1) {
    attack(state, monster, target);
    return;
  }

  stepToward(state, monster, target.pos);
}

/**
 * 気づくか。
 *
 * 条件は3つとも満たすこと:
 *   隠れていない相手（盗賊の「かげがくれ」）
 *   SIGHT 以内で、同じ部屋か真隣
 *   **正面側にいる**（向いている方向の半面。真横と背後は見えない）
 */
function spot(state: GameState, monster: Actor): Actor | undefined {
  const candidates = state.actors.filter(
    (a) =>
      a.alive &&
      isHostile(monster, a) &&
      !hasEffect(a, 'hidden', state.turn) &&
      manhattan(monster.pos, a.pos) <= SIGHT &&
      canSee(state, monster.pos, a.pos) &&
      inFront(monster, a.pos),
  );
  return nearest(monster, candidates);
}

/** 追っている相手。追跡中は背後でも見失わないが、隠れられると見失う */
function chaseTarget(state: GameState, monster: Actor): Actor | undefined {
  const candidates = state.actors.filter(
    (a) =>
      a.alive &&
      isHostile(monster, a) &&
      !hasEffect(a, 'hidden', state.turn) &&
      canSee(state, monster.pos, a.pos),
  );
  return nearest(monster, candidates);
}

function nearest(from: Actor, list: Actor[]): Actor | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((closest, a) =>
    manhattan(from.pos, a.pos) < manhattan(from.pos, closest.pos) ? a : closest,
  );
}

/**
 * 向いている方向の視野に入っているか。
 *
 * 最初は「正面の半面（内積 > 0）」にしていたが、それだと視野が 180 度あり、
 * 斜め前からでも必ず見つかる。45 度の円錐に絞って、
 * **横から回り込めば近づける**ようにした。
 *
 *   along … 向いている方向にどれだけ進んだ位置にいるか
 *   side  … そこから横にどれだけずれているか
 *
 * 横ずれが前後の距離以下なら視野の中。真横（along 0）は見えない。
 */
function inFront(monster: Actor, to: Pos): boolean {
  const d = DIR_DELTA[monster.facing];
  const dx = to.x - monster.pos.x;
  const dy = to.y - monster.pos.y;

  const along = dx * d.x + dy * d.y;
  if (along <= 0) return false;

  const side = Math.abs(dx * d.y - dy * d.x);
  return side <= along;
}

function canSee(state: GameState, from: Pos, to: Pos): boolean {
  if (chebyshev(from, to) <= 1) return true;

  const roomA = roomAt(state.floor, from.x, from.y);
  const roomB = roomAt(state.floor, to.x, to.y);
  return roomA !== undefined && roomA === roomB;
}

/**
 * 気づいていないときの動き。
 *
 * ただ突っ立っているだけだと、一度背後を取れば永久に安全になる。
 * ときどき向きを変えるので、回り込むには見ている方向を読む必要が出る。
 *
 * ## 対戦では動かない（03_改善構成.md 段階D）
 *
 * **この関数がモンスター側の乱数のほぼ全部。**
 * 対戦でこれを残すと、鏡像で左右まったく同じ盤を作っても、
 * 同じ位置のゴブリンが片方では通路をふさぎ、片方では部屋の隅に寄る。
 * 盤を対称にした意味が消えて「運で負けた」が戻ってくる。
 *
 * だから対戦では**見つけるまで一切動かない**。向きも変えない。
 * 見つけたあとの追跡（chaseTarget / stepToward）は決定論なので、
 * そのまま使える。
 *
 * 「運で負けた」が出たときに最初に疑うのがここだと仕様書に書いてある
 * （疑う順①）。疑う前に、まずここを読めば分かるようにしておく。
 */
function patrol(state: GameState, monster: Actor): void {
  if (state.mode === 'versus') return;

  const roll = randInt(0, 3);

  if (roll === 0) {
    // 振り向くだけ。これがあるから「背後は永久に安全」にならない
    const dir = pick(['n', 's', 'e', 'w'] as const);
    if (dir) monster.facing = dir;
    return;
  }
  if (roll === 1) return; // その場にいる

  // 向いている方向へ歩く。だめなら適当な方向を向き直す
  if (tryMove(state, monster, monster.facing)) return;
  const dir = pick(['n', 's', 'e', 'w'] as const);
  if (dir) monster.facing = dir;
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

/** 動けたら true。壁と他の Actor には入れない。動いた方向を向く */
function tryMove(state: GameState, actor: Actor, dir: Dir): boolean {
  const delta = DIR_DELTA[dir];
  const nx = actor.pos.x + delta.x;
  const ny = actor.pos.y + delta.y;

  if (tileAt(state.floor, nx, ny) === 'wall') return false;
  if (actorAt(state, nx, ny)) return false;

  actor.pos = { x: nx, y: ny };
  actor.facing = dir;
  return true;
}

/** 殴られたら気づく。背後からでも2発目は通らない */
export function alertOnHit(state: GameState, monster: Actor, from: Pos): void {
  if (monster.kind !== 'monster') return;
  monster.facing = towardDir(monster.pos, from);
  if (monster.aware) return;
  monster.aware = true;
  // 不意を突かれたターンは動けない。忍び寄る意味をここで作る
  addEffect(monster, 'stun', state.turn, 0);
}

function towardDir(from: Pos, to: Pos): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
