import { ITEMS, type ItemId } from '../shared/items';
import { dungeonOf, type DungeonId } from '../shared/dungeons';
import { JOB_IDS, jobOf, type JobId } from '../shared/jobs';
import { BASE_SKILL, SKILLS, isSkillId, type SkillId } from '../shared/skills';
import { SPECIES, type SpeciesId } from '../shared/monsters';
import {
  BAG_H,
  BAG_W,
  FUEL_START,
  TEAM_SIZE,
  actorAt,
  teamForSlot,
  tileAt,
  type GameMode,
  type GameState,
  type ItemInstance,
  type Pos,
  type TeamId,
} from '../shared/types';
import { putIn } from './backpack';
import {
  arenaSpawn,
  arenaSpots,
  createFloor,
  createMirrorFloor,
  createTutorialFloor,
  scatterPositions,
  spawnPos,
} from './dungeon';
import { pick, randInt } from './random';

/*
 * 出る敵とアイテムはダンジョンごとに違う（shared/dungeons.ts）。
 * 同じ顔ぶれだと、どこへ潜っても同じ戦い方になる。
 * 重み付けは配列に重複して入れることで表している。
 */

/*
 * 開始アイテムは職業ごとに決まる（shared/jobs.ts の startingItem）。
 *
 * もとは slot 順にシャッフルして配っていた（03_改善構成.md §2-4、
 * 「クラスを入れずに役割を分ける」）。職業を入れた以上、
 * 配るものと職業がばらばらだと、戦士に爆弾が渡って役割がぼやける。
 */


/**
 * id の採番。v0 はサーバーが1プロセスなので、ただの連番で足りる。
 * 複数プロセスに分ける日が来たら、ここを見直す。
 */
let nextId = 1;
function newId(prefix: string): string {
  return `${prefix}${nextId++}`;
}

export function createInitialGame(
  dungeon: DungeonId = 'ruin',
  mode: GameMode = 'coop',
): GameState {
  const state: GameState = {
    mode,
    phase: 'lobby',
    dungeon,
    turn: 0,
    floor:
      mode === 'versus'
        ? createMirrorFloor()
        : dungeon === 'tutorial'
          ? createTutorialFloor()
          : createFloor(1),
    actors: [],
    items: [],
    log: [mode === 'versus' ? '相手を待っている' : '仲間が来るのを待っている'],
    logScope: [null],
    descendReady: [],
    floorStartedAt: 0,
    waitingFor: [],
    deadlineAt: null,
  };
  if (mode === 'versus') populateArena(state);
  else if (dungeon === 'tutorial') seedTutorial(state);
  else populateFloor(state);
  return state;
}

/**
 * チュートリアルの中身。**位置も中身も固定。**
 *
 * 部屋ごとに覚えることを1つだけ置く。2つ置くと、
 * どちらをやれと言われているのか分からなくなる。
 *
 *   右上 コウモリ1匹   ぶつかると攻撃になる
 *   右下 薬草1つ       乗ると拾う → 持ち物から使う
 *   左下 剣1本 + 階段  袋に入れているだけで攻撃が上がる → 降りて終わり
 *
 * 敵はコウモリだけ。一番弱く、倒せる手応えを最初に置くため。
 */
function seedTutorial(state: GameState): void {
  const put = (itemId: ItemId, pos: Pos) => {
    state.items.push({ id: newId('i'), itemId, pos, ownerId: null, at: null, rot: 0 });
  };

  /*
   * **置く場所は、通らないと先へ進めないマスにする。**
   *
   * 最初は部屋の真ん中に置いていた。自分で試したら、
   * 部屋の端を歩いて薬草を踏まずに次の部屋へ抜けてしまい、
   * 「薬草を拾え」と出たまま先に進めなくなった。
   * チュートリアルで迷子になるのでは意味がない。
   */

  // 出発点の真東。最初に右へ歩くと必ずぶつかる
  spawnMonster(state, 'bat', { x: 9, y: 3 });

  // 右上から右下へ降りる穴（9,6）のすぐ下。降りたら必ず乗る
  put('potion', { x: 9, y: 7 });

  // 右下から左下へ入って最初のマス。横切れば必ず乗る
  put('sword', { x: 5, y: 9 });
}

/**
 * ホームで選んだ持ち込みを覚えておく。実際に袋へ入れるのは startGame。
 * ロビーの間だけ受け付ける。
 */
const loadouts = new Map<string, ItemId[]>();
/** ホームで選んだ「持ち込むわざ」。職業の基本わざに加えて1つ */
const skillPicks = new Map<string, SkillId>();

/**
 * 持ち込むわざ。職業が合っていないものは受け取らない。
 * 倉庫と同じで自己申告だが、職業の違うわざまで通すと見た目から破綻する。
 */
export function setSkillPick(state: GameState, id: string, skillId: string | null): void {
  if (state.phase !== 'lobby') return;
  const actor = state.actors.find((a) => a.id === id);
  if (!actor) return;

  if (skillId === null) {
    skillPicks.delete(id);
    return;
  }
  if (!isSkillId(skillId)) return;
  if (SKILLS[skillId].job !== actor.job) return;
  if (skillId === BASE_SKILL[actor.job ?? 'warrior']) return;
  skillPicks.set(id, skillId);
}

/** 遊んでいる人の名前。仲間の一覧に出すだけなので、長さだけ切る */
export function setPlayerName(state: GameState, id: string, name: string): void {
  const actor = state.actors.find((a) => a.id === id);
  if (!actor) return;
  actor.name = name.slice(0, 12);
}

export function setLoadout(state: GameState, id: string, itemIds: string[]): void {
  if (state.phase !== 'lobby') return;
  const valid = itemIds.filter((v): v is ItemId => v in ITEMS).slice(0, BAG_W * BAG_H);
  loadouts.set(id, valid);

  const actor = state.actors.find((a) => a.id === id);
  if (actor) pushLog(state, `${actor.slot}番が ${valid.length} 個 持ち込む`);
}

/** ロビーから探索を始める。ここで開始アイテムを配る */
export function startGame(state: GameState): void {
  if (state.phase !== 'lobby') return;
  state.phase = 'playing';

  for (const player of state.actors.filter((a) => a.kind === 'player')) {
    // 職業の基本装備 + ホームから持ち込んだもの。
    // 入らなかったぶんは黙って捨てる（袋の大きさが上限）
    const bring: ItemId[] = [jobOf(player.job).startingItem, ...(loadouts.get(player.id) ?? [])];
    for (const itemId of bring) {
      const item: ItemInstance = {
        id: newId('i'),
        itemId,
        pos: null,
        ownerId: null,
        at: null,
        rot: 0,
      };
      state.items.push(item);
      if (!putIn(state, player.id, item)) {
        state.items = state.items.filter((i) => i.id !== item.id);
      }
    }
    loadouts.delete(player.id);

    // 持ち込むわざ。覚え直す手間を省くぶん、浅いところを周回する意味が出る
    const extra = skillPicks.get(player.id);
    if (extra && SKILLS[extra].job === player.job && !player.skills.includes(extra)) {
      player.skills.push(extra);
      pushLog(state, `${player.slot}番は${SKILLS[extra].name}を覚えている`);
    }
    skillPicks.delete(player.id);
  }

  pushLog(state, 'ダンジョンに入った');
}

export function addPlayer(state: GameState, id: string): void {
  if (state.actors.some((a) => a.id === id)) return;

  const players = state.actors.filter((a) => a.kind === 'player');
  const used = new Set(players.map((a) => a.slot));
  let slot = 1;
  while (used.has(slot)) slot++;

  // まだ誰も選んでいない職業を既定にする。
  // 全員が同じ職業で始まるより、何も考えずに始めても噛み合うほうがいい
  const taken = new Set(players.map((a) => a.job));
  const job: JobId = JOB_IDS.find((j) => !taken.has(j)) ?? 'warrior';
  const def = jobOf(job);

  /*
   * チーム分け。
   *
   * 協力モードはプレイヤー全員がチーム A（isHostile が team で判定するので、
   * 同じチームなら殴り合わない）。対戦では slot の前半が A、後半が B。
   * **人数は TEAM_SIZE 1つで決まる**ので、1vs1 と 2vs2 でここは変わらない。
   */
  const team: TeamId = state.mode === 'versus' ? teamForSlot(slot) : 'A';

  state.actors.push({
    id,
    kind: 'player',
    team,
    speciesId: 'hero',
    pos: state.mode === 'versus' ? versusSpawn(state, team, slot) : freeSpawn(state),
    hp: def.maxHp,
    maxHp: def.maxHp,
    atk: def.atk,
    def: def.def,
    alive: true,
    fuel: FUEL_START,
    // 絵は右を向いて描かれている。最初から裏返っていると不自然
    facing: 'e',
    slot,
    aware: true, // プレイヤーは常に「起きている」。向きと気づきは敵だけの仕組み
    effects: {},
    name: '',
    job,
    skills: [BASE_SKILL[job]],
    cooldowns: {},
    level: 1,
    exp: 0,
    pendingLevels: 0,
    offers: [],
    perks: [],
  });
  pushLog(state, `${slot}番が加わった（${def.name}）`);
}

/**
 * ロビーで職業を変える。
 *
 * 始まってからは変えさせない。レベルもカードも職業の上に積み上がっているので、
 * 途中で替えると、積み上げたものをどう引き継ぐかという問題が丸ごと増える。
 */
export function chooseJob(state: GameState, id: string, job: JobId): void {
  if (state.phase !== 'lobby') return;

  const actor = state.actors.find((a) => a.id === id && a.kind === 'player');
  if (!actor) return;
  if (actor.job === job) return;

  const def = jobOf(job);
  actor.job = job;
  actor.maxHp = def.maxHp;
  actor.hp = def.maxHp;
  actor.atk = def.atk;
  actor.def = def.def;
  // 覚えているわざも入れ替える。前の職業のわざを持ち越させない
  actor.skills = [BASE_SKILL[job]];
  actor.cooldowns = {};
  pushLog(state, `${actor.slot}番は${def.name}を選んだ`);
}

export function removePlayer(state: GameState, id: string): void {
  state.actors = state.actors.filter((a) => a.id !== id);
  state.items = state.items.filter((i) => i.ownerId !== id);
  state.descendReady = state.descendReady.filter((p) => p !== id);
}

/** 階段を降りる。最深部まで来ていたらクリア */
export function descend(state: GameState): void {
  const spent = state.turn - state.floorStartedAt;

  if (state.floor.depth >= dungeonOf(state.dungeon).depth) {
    state.phase = 'won';
    pushLog(state, `${dungeonOf(state.dungeon).name}を踏破した！`);
    return;
  }

  state.floor = createFloor(state.floor.depth + 1);
  state.descendReady = [];
  state.floorStartedAt = state.turn;

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

  // 1フロアに何ターンかかったかを出す。
  // フロアの広さを決めるには、紙の上の試算ではなく実測が要る
  pushLog(state, `${state.floor.depth}F に降りた（前のフロアに ${spent} ターン）`);
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

/**
 * 対戦の出現位置。自陣の奥から、チーム内の順番でずらす。
 *
 * **乱数を使わない。** 出発点が抽選で決まると、
 * それ自体が「運で負けた」の種になる（00_ゴール定義.md）。
 */
function versusSpawn(state: GameState, team: TeamId, slot: number): Pos {
  const index = (slot - 1) % TEAM_SIZE;
  const base = arenaSpawn(state.floor, team, index);
  if (!actorAt(state, base.x, base.y)) return base;
  // 埋まっていたら次の候補へ。index をずらすだけなので、やはり乱数は要らない
  for (let i = 1; i <= TEAM_SIZE + 2; i++) {
    const p = arenaSpawn(state.floor, team, index + i);
    if (!actorAt(state, p.x, p.y)) return p;
  }
  return base;
}

/**
 * 対戦のフロアに中身を置く。**左半分に置いて、鏡の位置に同じものを置く。**
 *
 * 同じ敵・同じアイテムが同じ距離に必ず2つあるので、
 * 「相手だけ剣を拾った」が起きない。これが鏡像にした理由そのもの
 * （03_改善構成.md 段階D）。
 *
 * 数が少ないのは、D6 の目的が「対戦が通しで遊べること」の確認だから。
 * 中身を増やすのは段階 D8（ドラフト）で判断する。
 */
const ARENA_MONSTERS = 2;
const ARENA_ITEMS = 2;

function populateArena(state: GameState): void {
  const spots = arenaSpots(state.floor, ARENA_MONSTERS + ARENA_ITEMS);
  const mirror = (p: Pos): Pos => ({ x: state.floor.width - 1 - p.x, y: p.y });

  for (let i = 0; i < spots.length; i++) {
    const pos = spots[i];
    if (i < ARENA_MONSTERS) {
      /*
       * 敵はコウモリとゴブリンだけ。**種類も左右で同じものを置く。**
       * モンスターはどちらの陣営でもない（team 'M'）ので、
       * 両チームの共通の障害物になる。
       */
      const speciesId = i % 2 === 0 ? 'goblin' : 'bat';
      spawnMonster(state, speciesId, pos);
      spawnMonster(state, speciesId, mirror(pos));
    } else {
      // 左右で同じ中身。片方だけ薬草が出る盤を作らない
      const itemId: ItemId = i % 2 === 0 ? 'potion' : 'torch';
      for (const p of [pos, mirror(pos)]) {
        state.items.push({ id: newId('i'), itemId, pos: p, ownerId: null, at: null, rot: 0 });
      }
    }
  }
}

/**
 * 対戦を始めるときに、空いている席を AI で埋める（段階 D6）。
 *
 * **これが「作者1人で通しで確認できる」の全部。**
 * 人間を2人そろえないと一度も遊べない状態では、対戦の作りかけを
 * 確かめる手段が無い。AI は人間とまったく同じ規則で動く駒で、
 * 違うのは行動を誰が決めるかだけ（Actor.bot に理由）。
 */
export function fillWithBots(state: GameState): void {
  if (state.mode !== 'versus') return;

  const seats = TEAM_SIZE * 2;
  // addPlayer が空いている一番小さい slot を取るので、埋まるまで足すだけでよい
  while (state.actors.filter((a) => a.kind === 'player').length < seats) {
    const id = newId('bot');
    addPlayer(state, id);
    const bot = state.actors.find((a) => a.id === id);
    if (!bot) break; // 念のため。無限に回さない
    bot.bot = true;
    bot.name = 'あいて';

    /*
     * **相手と同じ職業にする。**
     *
     * addPlayer の既定は「まだ誰も選んでいない職業」なので、
     * 戦士を選んだ人の相手が魔法使いになる。盤を鏡像にしてまで
     * 条件を揃えたのに、職業差が抽選で決まっては意味がない。
     * 鏡の相手は自分と同じ性能にして、差は**判断だけ**にする。
     *
     * 持ち込み（倉庫から入れたもの）は AI には無いので、そこはまだ揃っていない。
     * 揃えるのは段階 D8（ドラフト）の仕事。
     */
    const mirrorSlot = bot.slot > TEAM_SIZE ? bot.slot - TEAM_SIZE : bot.slot + TEAM_SIZE;
    const foe = state.actors.find((a) => a.kind === 'player' && a.slot === mirrorSlot);
    if (foe?.job) chooseJob(state, bot.id, foe.job);

    pushLog(state, `${bot.slot}番は AI が動かす`);
  }
}

/** 今いるフロアにモンスターとアイテムを撒く */
function populateFloor(state: GameState): void {
  const { floor } = state;

  const def = dungeonOf(state.dungeon);
  const [lo, hi] = def.monsterBase;
  const monsterCount = randInt(lo, hi) + floor.depth;
  const itemCount = randInt(2, 4);

  const spots = scatterPositions(floor, monsterCount + itemCount);

  for (let i = 0; i < spots.length; i++) {
    const pos = spots[i];

    if (i < monsterCount) {
      spawnMonster(state, pick(def.monsters) ?? 'goblin', pos);
    } else {
      state.items.push({
        id: newId('i'),
        itemId: pick(def.items) ?? 'potion',
        pos,
        ownerId: null,
        at: null,
        rot: 0,
      });
    }
  }

  if (floor.depth === 1) seedFirstRoom(state);
}

function spawnMonster(state: GameState, speciesId: SpeciesId, pos: Pos): void {
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
    slot: 0,
    // 向きはばらばらに。全部同じ方を向いていると、どの部屋も同じ攻略になる
    facing: pick(['n', 's', 'e', 'w'] as const) ?? 'n',
    // 最初は誰にも気づいていない。だから忍び寄れる
    aware: false,
    effects: {},
    // 以下はプレイヤー専用。型を分けないと決めてある（設計書 §3-1）ので、
    // モンスターは使わない値で埋めておく
    name: '',
    job: null,
    skills: [],
    cooldowns: {},
    level: 1,
    exp: 0,
    pendingLevels: 0,
    offers: [],
    perks: [],
  });
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
      if (tileAt(state.floor, x, y) !== 'floor') continue;
      const d = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
      if (d < 2) continue; // 真隣には置かない
      free.push({ x, y });
    }
  }
  if (free.length === 0) return;

  const dist = (p: Pos) => Math.abs(p.x - spawn.x) + Math.abs(p.y - spawn.y);
  free.sort((a, b) => dist(a) - dist(b));

  // 近いところに薬草。歩いているうちに勝手に拾える
  state.items.push({
    id: newId('i'),
    itemId: 'potion',
    pos: free[0],
    ownerId: null,
    at: null,
    rot: 0,
  });

  // 一番遠いところに一番弱い敵。倒せる成功体験を最初に置く
  if (free.length > 1) spawnMonster(state, 'bat', free[free.length - 1]);
}

/** 誰かの持ち物 */
export function inventoryOf(state: GameState, ownerId: string): ItemInstance[] {
  return state.items.filter((i) => i.ownerId === ownerId);
}

/*
 * ────────── ログのスコープ（03_改善構成.md 段階D D4） ──────────
 */

/**
 * いま出すログを誰に見せるか。null は全員。
 *
 * **モジュールの変数に置いてある。** pushLog の引数にすると、
 * 60か所ある呼び出しを全部直すことになり、1か所書き忘れただけで
 * 相手の行動が漏れる。resolve が「いま誰の行動を処理しているか」を
 * ここに置き、pushLog はそれを読むだけにしておけば、書き忘れが起きない。
 *
 * サーバーは1プロセスで、1ターンの解決は途中で中断されない（await が無い）。
 * だから部屋が複数あっても混ざらない。await を入れる日が来たら、
 * ここを state の欄に移すこと。
 */
let currentLogScope: TeamId | null = null;

/**
 * これから出すログを誰に見せるか決める。
 * Actor をそのまま渡せる（モンスターは 'M' なので「全員」になる）。
 */
export function setLogScope(team: TeamId | 'M' | null): void {
  currentLogScope = team === 'M' ? null : team;
}

/**
 * いま誰向けになっているか。
 * 一時的に広げてから戻したい側（combat.ts の殴り合い）が読む。
 */
export function logScopeNow(): TeamId | null {
  return currentLogScope;
}

/** ログは増えすぎないように頭から捨てる */
export function pushLog(state: GameState, message: string): void {
  state.log.push(message);
  state.logScope.push(currentLogScope);
  if (state.log.length > 20) {
    state.log.shift();
    // 2つの配列は同じ長さ・同じ並びでなければならない。
    // ずれると「誰に見せるか」が1行ぶん後ろの行に付く
    state.logScope.shift();
  }
}

// ITEMS は重み付きテーブルの妥当性チェックにだけ使う
void ITEMS;
