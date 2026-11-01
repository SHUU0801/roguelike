import type { Floor, Pos, Rect, TileKind } from '../shared/types';
import { pick, randInt, shuffle } from './random';

/**
 * ダンジョン生成。
 *
 * 方式は一番理解しやすいものを採る（設計書 §8）:
 *   1. 矩形の部屋をランダムな位置・大きさで置こうとする
 *   2. すでにある部屋と重なったら、その部屋は捨てる
 *   3. 置けた部屋を、順番に L 字の通路でつなぐ
 *   4. 最後の部屋に階段を置く
 *
 * BSP や洞窟生成（セルオートマトン）は使わない。
 * 入口を createFloor() 1つに閉じてあるので、後から丸ごと差し替えられる。
 * v1.5 の鏡像ダンジョンも、ここに関数を1つ足すだけで済む形。
 */

/**
 * フロアの広さ。深いほど少し広い。
 *
 * 21 固定から縮めた。総ターンの7〜8割が「歩くだけ」で、同期ターンでは
 * その待ち時間に人数が掛かる（03_改善構成.md §2-2）。
 * ソロの進行感より、4人で黙々と歩く時間を削るほうを採った。
 */
function floorSize(depth: number): number {
  return 15 + depth;
}

/** 部屋を置こうとする回数。多いほど部屋が増えるが、頭打ちになる */
const ROOM_ATTEMPTS = 40;
const ROOM_MIN = 4;
const ROOM_MAX = 7;

export function createFloor(depth: number): Floor {
  const FLOOR_W = floorSize(depth);
  const FLOOR_H = floorSize(depth);
  const tiles: TileKind[] = new Array<TileKind>(FLOOR_W * FLOOR_H).fill('wall');
  const rooms: Rect[] = [];

  // 1-2. 重ならないように部屋を置く
  for (let i = 0; i < ROOM_ATTEMPTS; i++) {
    const w = randInt(ROOM_MIN, ROOM_MAX);
    const h = randInt(ROOM_MIN, ROOM_MAX);
    const room: Rect = {
      x: randInt(1, FLOOR_W - w - 2),
      y: randInt(1, FLOOR_H - h - 2),
      w,
      h,
    };
    if (rooms.some((other) => overlaps(other, room))) continue;
    rooms.push(room);
  }

  const floor: Floor = {
    depth,
    width: FLOOR_W,
    height: FLOOR_H,
    tiles,
    rooms,
    seen: new Array<boolean>(FLOOR_W * FLOOR_H).fill(false),
    visible: new Array<boolean>(FLOOR_W * FLOOR_H).fill(false),
  };

  // 部屋の内側を床で塗る
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        setTile(floor, x, y, 'floor');
      }
    }
  }

  // 3. 隣り合う部屋を L 字の通路でつなぐ
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(floor, centerOf(rooms[i - 1]), centerOf(rooms[i]));
  }

  // 4. 最後の部屋に階段を置く。出現位置は最初の部屋なので、ふつうは離れる。
  //
  // ただし部屋が1つしか置けなかったときは、最初の部屋 = 最後の部屋になり、
  // 中心に置くと出現位置とぴったり重なる。そうなると開幕から「降りる」が押せて、
  // 1歩も歩かずにフロアを飛ばせてしまう。実際に本番で踏んだ。
  const stairsRoom = rooms[rooms.length - 1];
  if (stairsRoom) {
    const spawn = spawnPos(floor);
    let p = centerOf(stairsRoom);
    if (p.x === spawn.x && p.y === spawn.y) p = farthestIn(stairsRoom, spawn);
    setTile(floor, p.x, p.y, 'stairs');
  }

  return floor;
}

/** 部屋の中で、ある点から一番遠いマス。階段が出現位置と重なるのを避けるのに使う */
function farthestIn(room: Rect, from: Pos): Pos {
  let best: Pos = { x: room.x, y: room.y };
  let bestDist = -1;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 階段のマス。無ければ undefined */
export function stairsPos(floor: Floor): Pos | undefined {
  const i = floor.tiles.indexOf("stairs");
  if (i < 0) return undefined;
  return { x: i % floor.width, y: Math.floor(i / floor.width) };
}

/** プレイヤーの出現位置。最初の部屋の中心 */
export function spawnPos(floor: Floor): Pos {
  const room = floor.rooms[0];
  return room ? centerOf(room) : { x: 1, y: 1 };
}

/**
 * モンスターやアイテムを置ける床マス。
 * 階段のマスと、除外したい座標は避ける。
 */
export function randomFloorPos(floor: Floor, exclude: Pos[] = []): Pos | undefined {
  const candidates: Pos[] = [];
  for (const room of floor.rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (tileOf(floor, x, y) !== 'floor') continue;
        if (exclude.some((p) => p.x === x && p.y === y)) continue;
        candidates.push({ x, y });
      }
    }
  }
  return pick(candidates);
}

// --- 以下は中で使う小さな関数 ---

/** 1マス分の余白を空けて重なり判定する（部屋同士がくっつかないように） */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

function centerOf(room: Rect): Pos {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function setTile(floor: Floor, x: number, y: number, kind: TileKind): void {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return;
  floor.tiles[y * floor.width + x] = kind;
}

function tileOf(floor: Floor, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return 'wall';
  return floor.tiles[y * floor.width + x];
}

/** 横→縦 か 縦→横 のどちらかで L 字に掘る */
function carveCorridor(floor: Floor, from: Pos, to: Pos): void {
  if (randInt(0, 1) === 0) {
    carveH(floor, from.x, to.x, from.y);
    carveV(floor, from.y, to.y, to.x);
  } else {
    carveV(floor, from.y, to.y, from.x);
    carveH(floor, from.x, to.x, to.y);
  }
}

function carveH(floor: Floor, x1: number, x2: number, y: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    if (tileOf(floor, x, y) === 'wall') setTile(floor, x, y, 'floor');
  }
}

function carveV(floor: Floor, y1: number, y2: number, x: number): void {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    if (tileOf(floor, x, y) === 'wall') setTile(floor, x, y, 'floor');
  }
}

/**
 * モンスターやアイテムを置く位置をまとめて選ぶ。
 * できるだけ最初の部屋（プレイヤーの出現場所）を避ける。
 */
export function scatterPositions(floor: Floor, count: number): Pos[] {
  const rooms = floor.rooms.length > 1 ? floor.rooms.slice(1) : floor.rooms;

  const candidates: Pos[] = [];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (tileOf(floor, x, y) !== 'floor') continue; // 階段のマスは避ける
        candidates.push({ x, y });
      }
    }
  }

  return shuffle(candidates).slice(0, count);
}

/*
 * ────────── チュートリアル ──────────
 */

/**
 * チュートリアルの地形。**毎回まったく同じ。**
 *
 * ランダムだと「次はここで殴る」と教えられない。
 * 順路を1本にして、部屋ごとに覚えることを1つだけ置く。
 *
 *   左上 = 出発    右上 = たたかう
 *   右下 = ひろう・つかう    左下 = そうび・おりる
 *
 * 絵のとおりに読める形で持つ。座標の表より間違いに気づきやすい。
 *   # 壁 / . 床 / > 階段
 */
const TUTORIAL_MAP = [
  '#############',
  '#.....#.....#',
  '#.....#.....#',
  '#...........#',
  '#.....#.....#',
  '#.....#.....#',
  '#########.###',
  '#.....#.....#',
  '#.....#.....#',
  '#...........#',
  '#.....#.....#',
  '#..>..#.....#',
  '#############',
];

/** チュートリアルの4部屋。順路の並びで持つ（rooms[0] が出発点） */
export const TUTORIAL_ROOMS: Rect[] = [
  { x: 1, y: 1, w: 5, h: 5 }, // 左上・出発
  { x: 7, y: 1, w: 5, h: 5 }, // 右上・たたかう
  { x: 7, y: 7, w: 5, h: 5 }, // 右下・ひろう
  { x: 1, y: 7, w: 5, h: 5 }, // 左下・そうび／階段
];

export function createTutorialFloor(): Floor {
  const height = TUTORIAL_MAP.length;
  const width = TUTORIAL_MAP[0].length;
  const tiles: TileKind[] = [];

  for (const row of TUTORIAL_MAP) {
    if (row.length !== width) throw new Error('チュートリアルの地図の幅が揃っていない');
    for (const ch of row) {
      tiles.push(ch === '#' ? 'wall' : ch === '>' ? 'stairs' : 'floor');
    }
  }

  return {
    depth: 1,
    width,
    height,
    tiles,
    rooms: TUTORIAL_ROOMS,
    seen: new Array<boolean>(width * height).fill(false),
    visible: new Array<boolean>(width * height).fill(false),
  };
}
