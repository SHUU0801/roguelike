import { ITEMS, type ItemId } from '../shared/items';
import { SPECIES, speciesOf, type SpeciesId } from '../shared/monsters';
import {
  FUEL_START,
  MAX_DEPTH,
  actorAt,
  tileAt,
  type GameState,
  type ItemInstance,
  type Pos,
} from '../shared/types';
import { createFloor, scatterPositions, spawnPos } from './dungeon';
import { pick, randInt } from './random';

/** フロアに出すモンスターの種類。深さに関係なく同じ顔ぶれ（v0 の範囲） */
const MONSTER_POOL: SpeciesId[] = ['goblin', 'bat', 'slime'];
/**
 * アイテムの出現。配列に重複して入れることで重み付けにしている。
 * 均等だと剣と盾が出すぎて、そのほとんどが無価値になる。
 */
const ITEM_POOL: ItemId[] = [
  "potion", "potion", "potion", "potion",
  "torch", "torch", "torch",
  "bomb", "bomb",
  "sword", "sword",
  "shield", "shield",
  "scroll",
];

/** 持ち物の上限。スマホの画面に並ぶ数で決めている */
export const MAX_INVENTORY = 6;

/**
 * id の採番。v0 はサーバーが1プロセスなので、ただの連番で足りる。
 * 複数プロセスに分ける日が来たら、ここを見直す。
 */
let nextId = 1;
function newId(prefix: string): string {
  return `${prefix}${nextId++}`;
}

export function createInitialGame(): GameState {
  const state: GameState = {
    phase: 'lobby',
    turn: 0,
    floor: createFloor(1),
    actors: [],
    items: [],
    log: ['仲間が来るのを待っている'],
    waitingFor: [],
    deadlineAt: null,
  };
  populateFloor(state);
  return state;
}

/**
 * 1F の出現部屋にだけ、薬草1個とコウモリ1体を置く。
 *
 * 通常の配置は出現部屋を除外しているので、初見プレイヤーは
 * 「何もない暗い部屋から、真っ黒な通路を十数手歩く」ところから始まっていた。
 * どんなチュートリアル画面よりこれが効く。
 * 歩く → 拾う → 殴る が最初の30秒で全部起きる。
 */
function seedFirstRoom(state: GameState): void {
  const room = state.floor.rooms[0];
  if (!room) return;

  const spawn = spawnPos(state.floor);
  const free: Pos[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (tileAt(state.floor, x, y) !== "floor") continue;
      const d = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
      if (d < 2) continue; // 真隣には置かない
      free.push({ x, y });
    }
  }
  if (free.length === 0) return;

  // 近いところに薬草。歩いているうちに勝手に拾える
  free.sort(
    (a, b) =>
      Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y) -
      (Math.abs(b.x - spawn.x) + Math.abs(b.y - spawn.y)),
  );
  state.items.push({ id: newId("i"), itemId: "potion", pos: free[0], ownerId: null });

  // 一番遠いところに一番弱い敵。倒せる成功体験を最初に置く
  const far = free[free.length - 1];
  if (free.length > 1) {
    const species = SPECIES.bat;
    state.actors.push({
      id: newId("m"),
      kind: "monster",
      team: "M",
      speciesId: "bat",
      pos: far,
      hp: species.maxHp,
      maxHp: species.maxHp,
      atk: species.atk,
      def: species.def,
      alive: true,
      fuel: 0,
    });
  }
}

/** ロビーから探索を始める */
export function startGame(state: GameState): void {
  if (state.phase !== 'lobby') return;
  state.phase = 'playing';
  pushLog(state, 'ダンジョンに入った');
}

export function addPlayer(state: GameState, id: string): void {
  if (state.actors.some((a) => a.id === id)) return;

  const species = speciesOf('hero');
  state.actors.push({
    id,
    kind: 'player',
    // 協力モードではプレイヤーは全員同じチーム。
    // v1.5 ではここが 'A' / 'B' に分かれる
    team: 'A',
    speciesId: 'hero',
    pos: freeSpawn(state),
    hp: species.maxHp,
    maxHp: species.maxHp,
    atk: species.atk,
    def: species.def,
    alive: true,
    fuel: FUEL_START,
  });
  pushLog(state, `${species.name}が1人加わった`);
}

export function removePlayer(state: GameState, id: string): void {
  state.actors = state.actors.filter((a) => a.id !== id);
  state.items = state.items.filter((i) => i.ownerId !== id);
}

/** 階段を降りる。最深部まで来ていたらクリア */
export function descend(state: GameState): void {
  if (state.floor.depth >= MAX_DEPTH) {
    state.phase = 'won';
    pushLog(state, 'ダンジョンを踏破した！');
    return;
  }

  state.floor = createFloor(state.floor.depth + 1);

  // 床に落ちているものは置いていく。持ち物は持って降りる
  state.items = state.items.filter((i) => i.ownerId !== null);
  state.actors = state.actors.filter((a) => a.kind === 'player');

  // 重ならないように1人ずつ置く
  for (const actor of state.actors) {
    actor.pos = { x: -1, y: -1 };
  }
  for (const actor of state.actors) {
    actor.pos = freeSpawn(state);
  }

  populateFloor(state);
  pushLog(state, `${state.floor.depth}F に降りた`);
}

/** 出現位置。すでに誰かいたら近くの空きマスへずらす */
function freeSpawn(state: GameState): Pos {
  const base = spawnPos(state.floor);
  if (!actorAt(state, base.x, base.y)) return base;

  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = base.x + dx;
        const y = base.y + dy;
        const tile = tileAt(state.floor, x, y);
        if (tile === 'wall' || tile === 'stairs') continue;
        if (actorAt(state, x, y)) continue;
        return { x, y };
      }
    }
  }
  return base;
}

/** 今いるフロアにモンスターとアイテムを撒く */
function populateFloor(state: GameState): void {
  const { floor } = state;

  const monsterCount = randInt(3, 5) + floor.depth;
  const itemCount = randInt(2, 4);

  const spots = scatterPositions(floor, monsterCount + itemCount);

  for (let i = 0; i < spots.length; i++) {
    const pos = spots[i];

    if (i < monsterCount) {
      const speciesId = pick(MONSTER_POOL) ?? 'goblin';
      const species = SPECIES[speciesId];
      state.actors.push({
        id: newId('m'),
        kind: 'monster',
        team: 'M',
        speciesId,
        pos,
        hp: species.maxHp,
        maxHp: species.maxHp,
        atk: species.atk,
        def: species.def,
        alive: true,
        fuel: 0, // モンスターは松明を持たない
      });
    } else {
      const itemId = pick(ITEM_POOL) ?? 'potion';
      const item: ItemInstance = {
        id: newId('i'),
        itemId,
        pos,
        ownerId: null,
      };
      state.items.push(item);
    }
  }

  if (floor.depth === 1) seedFirstRoom(state);
}

/** 誰かの持ち物 */
export function inventoryOf(state: GameState, ownerId: string): ItemInstance[] {
  return state.items.filter((i) => i.ownerId === ownerId);
}

/** ログは増えすぎないように頭から捨てる */
export function pushLog(state: GameState, message: string): void {
  state.log.push(message);
  if (state.log.length > 20) state.log.shift();
}
