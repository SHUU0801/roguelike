import type { Floor, Pos, Rect, TeamId, TileKind } from '../shared/types';
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
 * ────────── 鏡像フロア（対戦。03_改善構成.md 段階D D5） ──────────
 */

/**
 * 対戦のフロアの広さ。
 *
 * **幅は必ず偶数**にする（半分を掘って折り返すので）。
 * 協力の `15 + depth` より小さい。対戦は「探して歩く」より
 * 「ぶつかってから考える」時間を長くしたいので、出会うまでを短くする。
 * **机上の値。遊んで詰める。**
 */
const ARENA_HALF_W = 9;
const ARENA_H = 15;

/**
 * 鏡像フロア。片側だけ掘って、左右に折り返す。
 *
 * ## なぜ鏡像にするか
 *
 * 対戦で一番避けたいのが「運で負けた」（00_ゴール定義.md）。
 * ふつうに生成すると、片側に部屋が3つ・もう片側に1つという盤が出る。
 * **地形の有利不利が抽選で決まる**のは、その最悪の形。
 * 左右対称なら、両者の条件は定義上まったく同じになる。
 *
 * ## ここで気づいた一番大事なこと
 *
 * **地形は隠さなくてよい。**
 * 相手の陣地は自陣をそのまま裏返したものなので、見えても新しい情報がない。
 * 隠すのは Actor の位置・床のアイテム・ログ・視界の4つだけで足りる。
 * 「タイル配列を部分マスクして送る」を作らずに済み、
 * 作業量が3分の1になった（03_改善構成.md 段階D の判断(1)）。
 *
 * ## 真ん中について
 *
 * 半分の右端（x = ARENA_HALF_W - 1）まで通路を1本必ず掘る。
 * 折り返すと、その通路が中央でつながって左右の行き来ができる。
 * **段階 D7 の扉はちょうどこの位置に置く。** いまは開いたままにしておく。
 */
export function createMirrorFloor(depth = 1): Floor {
  const half = carveHalf(ARENA_HALF_W, ARENA_H);
  const width = ARENA_HALF_W * 2;

  const tiles: TileKind[] = new Array<TileKind>(width * ARENA_H).fill('wall');
  for (let y = 0; y < ARENA_H; y++) {
    for (let x = 0; x < ARENA_HALF_W; x++) {
      const kind = half.tiles[y * ARENA_HALF_W + x];
      tiles[y * width + x] = kind;
      // 折り返し。左端が右端に、中央が中央の隣に来る
      tiles[y * width + (width - 1 - x)] = kind;
    }
  }

  /*
   * 部屋の一覧も折り返す。視界が「部屋ごと」なので、
   * ここを忘れると相手側の部屋に入っても足元8マスしか見えない。
   */
  const rooms: Rect[] = [];
  for (const r of half.rooms) rooms.push(r);
  for (const r of half.rooms) {
    rooms.push({ x: width - r.x - r.w, y: r.y, w: r.w, h: r.h });
  }

  return {
    depth,
    width,
    height: ARENA_H,
    tiles,
    rooms,
    seen: new Array<boolean>(width * ARENA_H).fill(false),
    visible: new Array<boolean>(width * ARENA_H).fill(false),
  };
}

/**
 * 片側だけを掘る。部屋 → L字通路 → 中央への通路。
 *
 * 階段は置かない。対戦は**相手を倒して決まる**ので、降りる先が無い。
 * （段階 D7 以降で「開門」を置くのはこの中央の通路）
 */
function carveHalf(width: number, height: number): Floor {
  const tiles: TileKind[] = new Array<TileKind>(width * height).fill('wall');
  const rooms: Rect[] = [];

  /*
   * 部屋は縦に並べる。
   *
   * 協力と同じ「ランダムに置いて重なったら捨てる」だと、
   * 幅 9 では1つしか置けない盤がしょっちゅう出る。
   * 対戦は盤が小さいので、**部屋が確実に複数ある**ほうを採った。
   * 縦の帯に分けて、その中で位置と大きさだけ振る。
   */
  const bands = 3;
  const bandH = Math.floor((height - 2) / bands);
  for (let i = 0; i < bands; i++) {
    const h = Math.min(bandH, randInt(3, 4));
    const w = randInt(4, width - 2);
    rooms.push({
      x: randInt(1, width - w - 1),
      y: 1 + i * bandH + randInt(0, Math.max(0, bandH - h)),
      w,
      h,
    });
  }

  const floor: Floor = {
    depth: 1,
    width,
    height,
    tiles,
    rooms,
    seen: new Array<boolean>(width * height).fill(false),
    visible: new Array<boolean>(width * height).fill(false),
  };

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        setTile(floor, x, y, 'floor');
      }
    }
  }

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(floor, centerOf(rooms[i - 1]), centerOf(rooms[i]));
  }

  // 中央へ抜ける通路。折り返したときに左右をつなぐ唯一の道になる。
  // 真ん中の帯から掘るので、どちらの陣地からも同じ距離
  const mid = centerOf(rooms[Math.floor(rooms.length / 2)]);
  carveH(floor, mid.x, width - 1, mid.y);

  return floor;
}

/**
 * 対戦の出現位置。チームごとに自陣の奥。
 *
 * A は左の一番奥（x が小さい側）、B はその鏡。
 * **鏡なので中央からの距離は必ず等しい。** 先に着く側が生まれない。
 */
export function arenaSpawn(floor: Floor, team: TeamId, index = 0): Pos {
  const half = floor.width / 2;

  // 自陣側の床マスのうち、中央から一番遠いもの
  const mine: Pos[] = [];
  for (const room of floor.rooms) {
    if (room.x >= half) continue; // 左半分の部屋だけ見る
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (tileOf(floor, x, y) !== 'floor') continue;
        mine.push({ x, y });
      }
    }
  }
  // 乱数を使わずに並べる。対戦の出発点が抽選で決まってはいけない。
  // x が小さい順、同じなら y が小さい順
  mine.sort((a, b) => a.x - b.x || a.y - b.y);

  const base = mine[Math.min(index, Math.max(0, mine.length - 1))] ?? { x: 1, y: 1 };
  if (team === 'A') return base;
  return { x: floor.width - 1 - base.x, y: base.y };
}

/**
 * 対戦でモンスターとアイテムを置く位置。**左半分だけ返す。**
 * 置く側（game.ts）が鏡の位置にも同じものを置く。
 */
export function arenaSpots(floor: Floor, count: number): Pos[] {
  const half = floor.width / 2;
  const spawnA = arenaSpawn(floor, 'A');

  const candidates: Pos[] = [];
  for (const room of floor.rooms) {
    if (room.x >= half) continue;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (tileOf(floor, x, y) !== 'floor') continue;
        // 出発点の真上には置かない。開幕で勝手に拾う／殴られるのを避ける
        if (Math.abs(x - spawnA.x) + Math.abs(y - spawnA.y) <= 1) continue;
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
