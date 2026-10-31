/**
 * v0 の型定義。サーバーとクライアントが両方これを import する。
 * 「同じ言語・同じ型をサーバーとクライアントで使い回す」のがこの構成の狙い。
 */

export type TileKind = 'wall' | 'floor' | 'stairs';

export type Pos = { x: number; y: number };

export type Dir = 'n' | 's' | 'e' | 'w';

/** プレイヤーのチーム。対戦（v1.5）では2つに分かれる */
export type TeamId = 'A' | 'B';

/** 盤上の所属。モンスターはどちらの味方でもないので 'M' */
export type Faction = TeamId | 'M';

/** 部屋の矩形。視界の処理とモンスターの配置に使う */
export type Rect = { x: number; y: number; w: number; h: number };

/** 方向 → 座標の差分 */
export const DIR_DELTA: Record<Dir, Pos> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

/** v0 のダンジョンの深さ。ここまで降りればクリア */
export const MAX_DEPTH = 5;

/** 1部屋に入れる人数 */
export const MAX_PLAYERS = 4;

/**
 * 1ターンの制限時間。
 * これが無いと、放置した1人が全員を止めてマルチプレイが破綻する（ゴール定義 §2）。
 * 計測は「そのターンで最初の誰かが動いた瞬間」から始まる。
 * 1人で遊んでいるときは動かない。
 */
export const TURN_LIMIT_MS = 20_000;

/**
 * 盤上で動くもの。プレイヤーもモンスターも同じ型にする。
 * 型を分けると戦闘処理を2回書くことになるため（設計書 §3-1）。
 */
export type Actor = {
  id: string;
  kind: 'player' | 'monster';
  /**
   * 敵味方の判定に使う。協力モードではプレイヤーは全員 'A'。
   * kind で判定しないのが要点（02_v1設計.md §6 の申し送り）。
   * 対戦では 'A' と 'B' に分かれるが、判定する側のコードは変えなくて済む。
   */
  team: Faction;
  speciesId: string; // 性能は shared/monsters.ts の表を引く
  pos: Pos;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  alive: boolean;
};

export type ItemInstance = {
  id: string;
  itemId: string; // 効果は shared/items.ts の表を引く
  pos: Pos | null; // 床にある → 座標 / 誰かが持っている → null
  ownerId: string | null;
};

export type Floor = {
  depth: number;
  width: number;
  height: number;
  /** 1次元配列。index = y * width + x */
  tiles: TileKind[];
  /** 生成された部屋。視界の処理に使う */
  rooms: Rect[];
  /** 一度でも見たか。地形だけ記憶として残すのに使う */
  seen: boolean[];
  /** 今この瞬間見えているか。Actor とアイテムはここが true のマスにしか出さない */
  visible: boolean[];
};

/** サーバーが持つ唯一の正しい状態 */
export type GameState = {
  /** lobby = 仲間を待っている状態。「はじめる」で playing になる */
  phase: 'lobby' | 'playing' | 'won' | 'lost';
  turn: number;
  floor: Floor;
  actors: Actor[];
  items: ItemInstance[];
  log: string[];
  /** まだ今ターンの行動を送っていないプレイヤーの id */
  waitingFor: string[];
  /** ターンの締め切り（epoch ミリ秒）。待っていないときは null */
  deadlineAt: number | null;
};

/**
 * プレイヤーがサーバーに送る「意図」。
 * 「攻撃」が無いのは、移動先にモンスターがいたらサーバーが攻撃に読み替えるため
 * （ローグライク定番の体当たり攻撃。ボタンが1つ減ってスマホの画面が助かる）。
 */
export type Intent =
  | { type: 'move'; dir: Dir }
  | { type: 'useItem'; instanceId: string }
  | { type: 'pickUp' }
  | { type: 'descend' }
  | { type: 'wait' };

/** マスの種類を取り出す。範囲外は壁として扱う */
export function tileAt(floor: Floor, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return 'wall';
  return floor.tiles[y * floor.width + x];
}

/** そのマスが一度でも見えたか（地形の記憶） */
export function seenAt(floor: Floor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
  return floor.seen[y * floor.width + x];
}

/** そのマスが今見えているか */
export function visibleAt(floor: Floor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
  return floor.visible[y * floor.width + x];
}

/** その座標を含む部屋。通路にいるなら undefined */
export function roomAt(floor: Floor, x: number, y: number): Rect | undefined {
  return floor.rooms.find(
    (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
  );
}

/**
 * 敵対しているか。**kind では判定しない。**
 * これ1つに閉じておけば、v1.5 でプレイヤー同士を戦わせるときも
 * 呼び出し側を書き換えずに済む。
 */
export function isHostile(a: Actor, b: Actor): boolean {
  return a.team !== b.team;
}

/** その座標にいる、生きている Actor */
export function actorAt(state: GameState, x: number, y: number): Actor | undefined {
  return state.actors.find((a) => a.alive && a.pos.x === x && a.pos.y === y);
}

/** その座標の床に落ちているアイテム */
export function itemAt(state: GameState, x: number, y: number): ItemInstance | undefined {
  return state.items.find((i) => i.pos !== null && i.pos.x === x && i.pos.y === y);
}

/** from から to への方向。隣接していなければ null */
export function dirTo(from: Pos, to: Pos): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === -1) return 'n';
  if (dx === 0 && dy === 1) return 's';
  if (dx === 1 && dy === 0) return 'e';
  if (dx === -1 && dy === 0) return 'w';
  return null;
}
