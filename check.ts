/** 使い捨ての動作確認スクリプト。npx tsx check.ts */
import {
  addPlayer,
  autoDraft,
  autoPickFor,
  beginDraft,
  chooseJob,
  createInitialGame,
  draftPick,
  fillWithBots,
  inventoryOf,
  setLogScope,
  startGame,
} from './src/server/game';
import { createFloor, spawnPos } from './src/server/dungeon';
import { DURATION, FX, fxAt, motionAt } from './src/client/motion';
import {
  digestToken,
  hashPassword,
  isValidLoginName,
  lockoutMs,
  newSessionToken,
  passwordProblem,
  verifyPassword,
} from './src/server/auth';
import { makeAccounts } from './src/server/accounts';
import { memoryStore } from './src/server/store';
import { CARRY_KEYS, applyDump, isEmptyDump, localDump } from './src/client/carry';
import { describeDump } from './src/client/account';
import { SKILL_IDS } from './src/shared/skills';
import { dungeonOf } from './src/shared/dungeons';
import { putIn, rearrange as rearrangeItem, usedCells } from './src/server/backpack';
import { awardExp, takePerk } from './src/server/levels';
import { resolveTurn, retireCleanup } from './src/server/resolve';
import { playerTeams, updateVision, visionOf } from './src/server/vision';
import { readFileSync } from 'node:fs';
import { attack, damage } from './src/server/combat';
import { monsterAct } from './src/server/ai';
import { botIntent } from './src/server/duel';
import { viewFor } from './src/server/view';
import { arenaSpawn, createMirrorFloor } from './src/server/dungeon';
import { JOBS, type JobId } from './src/shared/jobs';
import { BASE_SKILL } from './src/shared/skills';
import { OFFER_COUNT, PERKS, PERK_IDS, perkCount, perkOf } from './src/shared/perks';
import { ITEMS, type ItemId } from './src/shared/items';
import {
  BAG_H,
  DIR_DELTA,
  DRAFT_OFFER,
  DRAFT_ROUNDS,
  EXPLORE_TURNS,
  MATCH_TURNS,
  MAX_LEVEL,
  VERSUS_PLAYERS,
  effectiveAtk,
  effectiveDef,
  expToNext,
  tileAt,
  type Actor,
  type Dir,
  type Floor,
  type GameState,
  type Intent,
  type ItemInstance,
  type Pos,
} from './src/shared/types';

/**
 * 探索が始まったあとに職業を差し替える。
 * chooseJob はロビーの間しか効かないので、試験ではここで直接書き換える。
 */
function setJob(actor: Actor, job: JobId): void {
  const def = JOBS[job];
  actor.job = job;
  actor.maxHp = def.maxHp;
  actor.hp = def.maxHp;
  actor.atk = def.atk;
  actor.def = def.def;
  actor.skills = [BASE_SKILL[job]];
  actor.cooldowns = {};
}

let failed = 0;
function assert(cond: unknown, msg: string): void {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
}

function fresh(): { state: GameState; me: Actor } {
  const state = createInitialGame();
  addPlayer(state, 'p1');
  startGame(state);
  updateVision(state);
  const me = state.actors.find((a) => a.id === 'p1');
  if (!me) throw new Error('player missing');
  return { state, me };
}

function turn(state: GameState, intent: Intent): void {
  resolveTurn(state, new Map<string, Intent>([['p1', intent]]));
}

/**
 * 床に落ちているものを全部どける。
 *
 * ダンジョンは毎回ランダムなので、**自分の足元にたまたま物が湧く**ことがある。
 * そうなると itemAt が先に見つけたほうを返し、
 * 「置く」は「ここには置けない」で弾かれ、「拾う」は別の物を拾う。
 * 10回に1回落ちる試験の原因がこれだった。
 * 床の物を自分で置く試験では、先にどけておく。
 */
function clearFloor(state: GameState): void {
  state.items = state.items.filter((i) => i.pos === null);
}

/**
 * 試験用のアイテムを1つ置く。
 * 床に置くなら pos、誰かに持たせるなら owner を渡す。
 * ItemInstance の項目が増えるたびに何箇所も直すのが面倒なのでまとめた。
 */
function putItem(
  state: GameState,
  id: string,
  itemId: string,
  where: { pos?: Pos; owner?: string },
): ItemInstance {
  const item: ItemInstance = {
    id,
    itemId,
    pos: where.pos ?? null,
    ownerId: null,
    at: null,
    rot: 0,
  };
  state.items.push(item);
  if (where.owner) putIn(state, where.owner, item);
  return item;
}

/**
 * 壁でも他の Actor でもない隣のマスと、そこへ向かう方向。
 * 「東に敵を置いて東へ歩く」と書くと、東が壁のダンジョンで落ちる。
 */
function freeNeighbour(state: GameState, from: Actor): { dir: Dir; pos: Pos } {
  for (const dir of ['e', 'w', 'n', 's'] as Dir[]) {
    const d = DIR_DELTA[dir];
    const pos = { x: from.pos.x + d.x, y: from.pos.y + d.y };
    if (tileAt(state.floor, pos.x, pos.y) === 'wall') continue;
    if (state.actors.some((a) => a.pos.x === pos.x && a.pos.y === pos.y)) continue;
    return { dir, pos };
  }
  throw new Error('隣に空きマスが無い');
}

/**
 * 試験用の敵を1体置く。
 * Actor の項目が増えるたびに3箇所直すのが面倒なので、ここ1つにまとめた。
 */
function putMonster(
  state: GameState,
  id: string,
  speciesId: string,
  pos: { x: number; y: number },
  over: Partial<Actor> = {},
): Actor {
  const monster: Actor = {
    id,
    kind: 'monster',
    team: 'M',
    speciesId,
    pos,
    hp: 99,
    maxHp: 99,
    atk: 1,
    def: 0,
    alive: true,
    fuel: 0,
    slot: 0,
    facing: 'n',
    // 試験では既定で「気づいている」。気づいていない敵は不意打ちになるので、
    // 戦闘の試験をするときに結果が変わってしまう
    aware: true,
    effects: {},
    name: '',
    job: null,
    skills: [],
    cooldowns: {},
    level: 1,
    exp: 0,
    pendingLevels: 0,
    offers: [],
    perks: [],
    ...over,
  };
  state.actors.push(monster);
  return monster;
}

// --- 1. 盤面の中身 ---
{
  const { state } = fresh();
  const monsters = state.actors.filter((a) => a.kind === 'monster');
  assert(monsters.length >= 4, `モンスターが配置される (${monsters.length}体)`);
  assert(state.items.length >= 2, `アイテムが配置される (${state.items.length}個)`);
  assert(
    state.floor.visible.some(Boolean),
    '入室時点で視界が計算されている',
  );
}

// --- 2. 体当たり攻撃 ---
{
  const { state, me } = fresh();
  const monster = state.actors.find((a) => a.kind === 'monster');
  if (!monster) throw new Error('no monster');

  me.pos = { x: monster.pos.x - 1, y: monster.pos.y };
  const before = monster.hp;
  turn(state, { type: 'move', dir: 'e' });

  const after = state.actors.find((a) => a.id === monster.id);
  assert(
    after === undefined || after.hp < before,
    `体当たりでダメージが入る (${before} → ${after ? after.hp : '撃破'})`,
  );
}

// --- 3. アイテムを拾って使う ---
{
  const { state, me } = fresh();

  clearFloor(state);
  putItem(state, 'it-potion', 'potion', { pos: { ...me.pos } });
  turn(state, { type: 'pickUp' });
  assert(
    inventoryOf(state, 'p1').some((i) => i.id === 'it-potion'),
    '足元のアイテムを拾える',
  );

  me.hp = 5;
  turn(state, { type: 'useItem', instanceId: 'it-potion' });
  assert(me.hp > 5, `薬草で回復する (hp=${me.hp})`);
  assert(!state.items.some((i) => i.id === 'it-potion'), '使ったアイテムは消える');
}

// --- 4. 装備は袋に入れている間だけ効く ---
{
  const { state, me } = fresh();
  state.items = [];
  const atk0 = effectiveAtk(state, me);
  const def0 = effectiveDef(state, me);

  putItem(state, 'it-sword', 'sword', { owner: 'p1' });
  assert(
    effectiveAtk(state, me) === atk0 + 4 && effectiveDef(state, me) === def0 - 1,
    `剣を持つと 攻+4 防-1 (攻 ${atk0}→${effectiveAtk(state, me)} / 防 ${def0}→${effectiveDef(state, me)})`,
  );
  // 素の値は動かさない。レベルアップのぶんと混ざらないようにするため
  assert(me.atk === atk0 && me.def === def0, '素の能力値は変わらない');

  // 床に置くと効果も消える。ここが「使うと消える」との一番の違い
  turn(state, { type: 'drop', instanceId: 'it-sword' });
  assert(
    effectiveAtk(state, me) === atk0 && effectiveDef(state, me) === def0,
    `袋から出すと効果も消える (攻 ${effectiveAtk(state, me)} / 防 ${effectiveDef(state, me)})`,
  );
}

// --- 4b. 盾は守りと引き換えに攻撃が下がる ---
{
  const { state, me } = fresh();
  state.items = [];
  const atk0 = effectiveAtk(state, me);
  const def0 = effectiveDef(state, me);
  putItem(state, 'it-shield', 'shield', { owner: 'p1' });
  assert(
    effectiveDef(state, me) === def0 + 3 && effectiveAtk(state, me) === atk0 - 1,
    `盾は 防+3 攻-1 (防 ${def0}→${effectiveDef(state, me)} / 攻 ${atk0}→${effectiveAtk(state, me)})`,
  );
}

// --- 4c. 装備は使えない。袋から消えない ---
{
  const { state, me } = fresh();
  state.items = [];
  putItem(state, 'it-eq', 'shield', { owner: 'p1' });
  turn(state, { type: 'useItem', instanceId: 'it-eq' });
  const still = state.items.find((i) => i.id === 'it-eq');
  assert(
    still !== undefined && still.ownerId === 'p1',
    '装備は「使う」で消えない（袋に入れていることが効果）',
  );
  void me;
}

// --- 4d. 外すと効果は消えるが、袋のマスは食ったまま ---
{
  const { state, me } = fresh();
  state.items = [];
  const def0 = effectiveDef(state, me);
  putItem(state, 'it-shield', 'shield', { owner: 'p1' });
  const cells = usedCells(state, 'p1');

  turn(state, { type: 'toggleEquip', instanceId: 'it-shield' });
  assert(
    effectiveDef(state, me) === def0,
    `外すと守りが戻る (${def0} → ${effectiveDef(state, me)})`,
  );
  // ここが「床に置く」との違い。外しても荷物としては嵩張る
  assert(
    usedCells(state, 'p1') === cells,
    `外しても袋のマスは空かない (${cells} → ${usedCells(state, 'p1')})`,
  );

  turn(state, { type: 'toggleEquip', instanceId: 'it-shield' });
  assert(effectiveDef(state, me) === def0 + 3, 'つけ直すと効果が戻る');
}

// --- 4e. 付け外しはターンを使う ---
{
  const { state } = fresh();
  state.items = [];
  putItem(state, 'it-shield', 'shield', { owner: 'p1' });
  const t0 = state.turn;
  turn(state, { type: 'toggleEquip', instanceId: 'it-shield' });
  // 無料だと毎ターン付け替えられて、剣の弱点（防-1）が無いのと同じになる
  assert(state.turn === t0 + 1, `付け外しで1ターン進む (${t0} → ${state.turn})`);
}

// --- 4f. 他人の装備は外せない ---
{
  const { state } = fresh();
  addPlayer(state, 'p2');
  state.items = [];
  const item = putItem(state, 'it-mate', 'shield', { owner: 'p2' });
  turn(state, { type: 'toggleEquip', instanceId: 'it-mate' });
  assert(item.off !== true, '他人の持ち物は外せない');
}

// --- 5. 階段を降りる ---
{
  const { state, me } = fresh();
  const idx = state.floor.tiles.indexOf('stairs');
  me.pos = { x: idx % state.floor.width, y: Math.floor(idx / state.floor.width) };
  turn(state, { type: 'descend' });
  assert(state.floor.depth === 2, `階段で次のフロアへ (depth=${state.floor.depth})`);
  assert(
    state.actors.filter((a) => a.kind === 'monster').length > 0,
    '新しいフロアにもモンスターがいる',
  );
}

// --- 6. 最深部でクリア ---
{
  const { state, me } = fresh();
  state.floor.depth = 5;
  const idx = state.floor.tiles.indexOf('stairs');
  me.pos = { x: idx % state.floor.width, y: Math.floor(idx / state.floor.width) };
  turn(state, { type: 'descend' });
  assert(state.phase === 'won', `5F の階段でクリア (phase=${state.phase})`);
}

// --- 7. 倒れるとゲームオーバー ---
{
  const { state, me } = fresh();
  me.hp = 1;
  putMonster(state, 'bully', 'goblin', { x: me.pos.x + 1, y: me.pos.y }, { atk: 99 });
  turn(state, { type: 'wait' });
  assert(state.phase === 'lost', `倒れると lost になる (phase=${state.phase})`);
}

// --- 8. 対戦のダメージに乱数が入らない（v1.5 への仕込みの確認）---
{
  const { calcDamage } = await import('./src/server/combat');
  const a = { atk: 10, def: 0 } as Actor;
  const b = { atk: 0, def: 3 } as Actor;
  const pvp = new Set<number>();
  const coop = new Set<number>();
  for (let i = 0; i < 50; i++) {
    pvp.add(calcDamage(a, b, { pvp: true }));
    coop.add(calcDamage(a, b, { pvp: false }));
  }
  assert(pvp.size === 1 && pvp.has(7), `対戦のダメージは確定値 (${[...pvp].join(',')})`);
  assert(coop.size > 1, `協力のダメージは振れる (${[...coop].sort().join(',')})`);
}

// --- 9. 防御力が最後まで効く（乱数が加算項になっていない）---
{
  const { calcDamage } = await import('./src/server/combat');
  const atk = { atk: 10, def: 0 } as Actor;
  const low = { atk: 0, def: 2 } as Actor;
  const high = { atk: 0, def: 8 } as Actor;
  let sumLow = 0;
  let sumHigh = 0;
  for (let i = 0; i < 400; i++) {
    sumLow += calcDamage(atk, low, { pvp: false });
    sumHigh += calcDamage(atk, high, { pvp: false });
  }
  assert(
    sumHigh < sumLow * 0.5,
    `防御を積むほど被ダメージが減る (def2 平均 ${(sumLow / 400).toFixed(1)} → def8 平均 ${(sumHigh / 400).toFixed(1)})`,
  );
}

// --- 10. 爆弾が仲間に当たらない ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');
  mate.pos = { x: me.pos.x + 1, y: me.pos.y };
  const mateHp = mate.hp;

  putItem(state, 'it-bomb', 'bomb', { owner: 'p1'  });
  turn(state, { type: 'useItem', instanceId: 'it-bomb' });
  assert(mate.hp === mateHp, `爆弾は仲間に当たらない (HP ${mateHp} → ${mate.hp})`);
}

// --- 11. 乗ったら自動で拾う ---
{
  const { state, me } = fresh();
  clearFloor(state);
  // 東と決め打ちすると、東が壁のダンジョンで落ちる
  const spot = freeNeighbour(state, me);
  putItem(state, 'it-auto', 'potion', { pos: spot.pos });
  turn(state, { type: 'move', dir: spot.dir });
  assert(
    inventoryOf(state, 'p1').some((i) => i.id === 'it-auto'),
    'アイテムの上に乗ると、同じターンで拾う',
  );
}

// --- 12. 倒れたプレイヤーの持ち物が床に落ちる ---
{
  const { state, me } = fresh();
  putItem(state, 'it-drop', 'sword', { owner: 'p1'  });
  me.hp = 1;
  putMonster(state, 'bully2', 'goblin', { x: me.pos.x + 1, y: me.pos.y }, { atk: 99 });
  turn(state, { type: 'wait' });
  const dropped = state.items.find((i) => i.id === 'it-drop');
  assert(
    dropped !== undefined && dropped.ownerId === null && dropped.pos !== null,
    '倒れたプレイヤーの持ち物が床に落ちる',
  );
}

// --- 13. 松明が毎ターン減る ---
{
  const { state, me } = fresh();
  const before = me.fuel;
  turn(state, { type: 'wait' });
  turn(state, { type: 'wait' });
  assert(me.fuel === before - 2, `松明が毎ターン1減る (${before} → ${me.fuel})`);
}

// --- 14. 松明が尽きると毎ターン傷つく ---
{
  const { state, me } = fresh();
  me.fuel = 0;
  me.hp = me.maxHp;
  turn(state, { type: 'wait' });
  // 待機で +1、松明切れで -1。なので差し引きで減っているか、少なくとも満タンのまま
  const hpAfterOne = me.hp;
  me.hp = 10;
  turn(state, { type: 'wait' });
  assert(
    me.fuel === 0 && hpAfterOne <= me.maxHp,
    `松明が尽きても 0 より下がらない (fuel=${me.fuel})`,
  );
}

// --- 15. 松明で補充できる ---
{
  const { state, me } = fresh();
  me.fuel = 10;
  putItem(state, 'it-torch', 'torch', { owner: 'p1'  });
  turn(state, { type: 'useItem', instanceId: 'it-torch' });
  assert(me.fuel > 50, `松明をつぎ足せる (10 → ${me.fuel})`);
}

// --- 16. 待機すると少し回復する ---
{
  const { state, me } = fresh();
  // 周りに敵がいると殴られるので、隔離してから測る
  state.actors = state.actors.filter((a) => a.kind === 'player');
  me.hp = 10;
  turn(state, { type: 'wait' });
  assert(me.hp === 11, `待機で HP が1回復する (10 → ${me.hp})`);
}

// --- 17. 敵から離れると追撃される ---
{
  const { state, me } = fresh();
  state.actors = state.actors.filter((a) => a.kind === 'player');
  putMonster(state, 'chaser', 'goblin', { x: me.pos.x - 1, y: me.pos.y }, { hp: 30, maxHp: 30, atk: 8 });
  const before = me.hp;
  // 敵の反対側へ逃げる = 隣接から離れる
  turn(state, { type: 'move', dir: 'e' });
  assert(me.hp < before, `背を向けると追撃される (HP ${before} → ${me.hp})`);
}

// --- 18. 巻物は階段のそばへ飛ばす ---
{
  const { state, me } = fresh();
  const idx = state.floor.tiles.indexOf('stairs');
  const stairs = { x: idx % state.floor.width, y: Math.floor(idx / state.floor.width) };
  putItem(state, 'it-scroll', 'scroll', { owner: 'p1'  });
  turn(state, { type: 'useItem', instanceId: 'it-scroll' });
  const dist = Math.abs(me.pos.x - stairs.x) + Math.abs(me.pos.y - stairs.y);
  assert(dist <= 1, `巻物で階段のそばへ飛ぶ (階段からの距離 ${dist})`);
}

// --- 19. 1F の出現部屋に、拾えるものと弱い敵がいる ---
{
  const { state } = fresh();
  const room = state.floor.rooms[0];
  if (!room) throw new Error('no room');
  const inRoom = (p: { x: number; y: number }) =>
    p.x >= room.x && p.x < room.x + room.w && p.y >= room.y && p.y < room.y + room.h;

  const items = state.items.filter((i) => i.pos && inRoom(i.pos));
  const monsters = state.actors.filter((a) => a.kind === 'monster' && inRoom(a.pos));
  assert(
    items.length >= 1 && monsters.length >= 1,
    `1F の最初の部屋に物と敵がいる (アイテム${items.length} / 敵${monsters.length})`,
  );
}

// --- 20. 足元に置いて、仲間が拾える ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');

  clearFloor(state);
  putItem(state, 'it-give', 'potion', { owner: 'p1'  });
  turn(state, { type: 'drop', instanceId: 'it-give' });

  const onFloor = state.items.find((i) => i.id === 'it-give');
  assert(
    onFloor !== undefined && onFloor.ownerId === null && onFloor.pos !== null,
    '持ち物を足元に置ける',
  );

  // 置いた本人がそのマスに立ったままだと仲間は入れないので、まず退く
  if (onFloor?.pos) {
    me.pos = { x: onFloor.pos.x, y: onFloor.pos.y - 3 };
    mate.pos = { x: onFloor.pos.x - 1, y: onFloor.pos.y };
    resolveTurn(state, new Map<string, Intent>([['p2', { type: 'move', dir: 'e' }]]));
  }
  assert(
    state.items.find((i) => i.id === 'it-give')?.ownerId === 'p2',
    '置いたものを仲間が拾える = 渡せる',
  );
}

// --- 21. 同じマスに2つ置けない ---
{
  const { state } = fresh();
  clearFloor(state);
  putItem(state, 'it-a', 'potion', { owner: 'p1'  });
  putItem(state, 'it-b', 'bomb', { owner: 'p1'  });
  turn(state, { type: 'drop', instanceId: 'it-a' });
  turn(state, { type: 'drop', instanceId: 'it-b' });
  assert(
    state.items.find((i) => i.id === 'it-b')?.ownerId === 'p1',
    '足元が埋まっていたら置けない',
  );
}

// --- 22. 倒れた仲間を起こせる。代償は自分の最大HP ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');

  mate.alive = false;
  mate.hp = 0;
  mate.pos = { x: me.pos.x + 1, y: me.pos.y };
  const maxBefore = me.maxHp;

  turn(state, { type: 'revive' });
  // 起こされた本人は同じターンの「待機」で1回復するので、HP は 1 か 2
  assert(
    mate.alive && mate.hp >= 1 && me.maxHp === maxBefore - 4,
    `起こせる（相手 HP ${mate.hp} / 自分の最大HP ${maxBefore}→${me.maxHp}）`,
  );
}

// --- 23. 倒れた人も歩ける（偵察役）---
{
  const { state, me } = fresh();
  state.actors = state.actors.filter((a) => a.kind === 'player');
  me.alive = false;
  const before = { ...me.pos };
  // 壁に当たらない向きを探す
  for (const dir of ['e', 'w', 'n', 's'] as const) {
    turn(state, { type: 'move', dir });
    if (me.pos.x !== before.x || me.pos.y !== before.y) break;
  }
  assert(
    me.pos.x !== before.x || me.pos.y !== before.y,
    '倒れていても移動できる（視界を届けられる）',
  );
}

// --- 24. 階段は全員が同意するまで降りない ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');

  const idx = state.floor.tiles.indexOf('stairs');
  me.pos = { x: idx % state.floor.width, y: Math.floor(idx / state.floor.width) };
  const depth0 = state.floor.depth;

  // 1人だけ押しても降りない
  resolveTurn(state, new Map<string, Intent>([['p1', { type: 'descend' }]]));
  const heldBack = state.floor.depth === depth0;

  // 2人目が同意したら降りる
  resolveTurn(state, new Map<string, Intent>([['p2', { type: 'descend' }]]));
  assert(
    heldBack && state.floor.depth === depth0 + 1,
    `全員が同意するまで降りない（1人目で ${depth0} のまま → 2人目で ${state.floor.depth}）`,
  );
}

// --- 25. 開始時に1人1個ずつ違うものを持つ ---
{
  const state = createInitialGame();
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  startGame(state);
  const a = state.items.filter((i) => i.ownerId === 'p1');
  const b = state.items.filter((i) => i.ownerId === 'p2');
  assert(
    a.length === 1 && b.length === 1 && a[0].itemId !== b[0].itemId,
    `開始アイテムが人ごとに違う (${a[0]?.itemId} / ${b[0]?.itemId})`,
  );
}

// --- 26. 開始アイテムは職業で決まる ---
{
  const state = createInitialGame();
  addPlayer(state, 'p1');
  chooseJob(state, 'p1', 'mage');
  startGame(state);
  const mine = state.items.filter((i) => i.ownerId === 'p1');
  assert(
    mine.length === 1 && mine[0].itemId === JOBS.mage.startingItem,
    `魔法使いは ${JOBS.mage.startingItem} を持って始まる (${mine[0]?.itemId})`,
  );
}

// --- 27. 経験値はパーティ全員に同じだけ入る ---
{
  const state = createInitialGame();
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  startGame(state);
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const [p1, p2] = state.actors;

  // 壁でも仲間でもない隣を選ぶ。東と決め打ちすると、
  // ダンジョンの出来によっては壁を殴って試験が落ちる
  const spot = freeNeighbour(state, p1);
  const victim = putMonster(state, 'xp', 'bat', spot.pos, { hp: 1, maxHp: 1, atk: 0 });
  resolveTurn(
    state,
    new Map<string, Intent>([
      ['p1', { type: 'move', dir: spot.dir }],
      ['p2', { type: 'wait' }],
    ]),
  );
  assert(!victim.alive, 'とどめを刺せた（前提）');
  assert(
    p1.exp === p2.exp && p1.exp > 0,
    `経験値は倒していない人にも同じだけ入る (p1=${p1.exp} / p2=${p2.exp})`,
  );
}

// --- 28. レベルが上がるとカードが3枚出る ---
{
  const { state, me } = fresh();
  awardExp(state, expToNext(1));
  assert(me.level === 2, `経験値が満ちるとレベルが上がる (Lv${me.level})`);
  assert(me.pendingLevels === 1, `選んでいないレベルアップが溜まる (${me.pendingLevels})`);
  assert(me.offers.length === OFFER_COUNT, `カードが ${OFFER_COUNT} 枚出る (${me.offers.length})`);

  const atkBefore = me.atk;
  const picked = me.offers.includes('power') ? 'power' : me.offers[0];
  assert(takePerk(state, me, picked), 'カードを取れる');
  assert(me.pendingLevels === 0 && me.offers.length === 0, '取ると残りの札は消える');
  if (picked === 'power') {
    assert(me.atk === atkBefore + 2, `剛力で攻撃 +2 (${atkBefore} → ${me.atk})`);
  }
}

// --- 29. 提示していない札は取れない（好きな札を送られても困らない）---
{
  const { state, me } = fresh();
  awardExp(state, expToNext(1));
  const notOffered = PERK_IDS.find((id) => !me.offers.includes(id));
  assert(
    notOffered !== undefined && !takePerk(state, me, notOffered),
    '提示していない札は取れない',
  );
}

// --- 30. 同じ札は上限で止まる（防御を積んで無敵にならない）---
{
  const { state, me } = fresh();
  for (let i = 0; i < 10; i++) {
    me.pendingLevels = 1;
    me.offers = ['guard'];
    takePerk(state, me, 'guard');
  }
  assert(
    perkCount(me.perks, 'guard') === PERKS.guard.maxStacks,
    `鉄壁は ${PERKS.guard.maxStacks} 枚で止まる (${perkCount(me.perks, 'guard')})`,
  );
}

// --- 31. 戦士のスキルは隣の敵を全部殴る ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const a = putMonster(state, 's1', 'goblin', { x: me.pos.x + 1, y: me.pos.y }, {
    hp: 50,
    maxHp: 50,
    atk: 0,
  });
  const b = putMonster(state, 's2', 'goblin', { x: me.pos.x - 1, y: me.pos.y }, {
    hp: 50,
    maxHp: 50,
    atk: 0,
  });
  turn(state, { type: 'skill', skillId: 'cleave' });
  assert(a.hp < 50 && b.hp < 50, `ぶんまわしが両隣に当たる (${a.hp} / ${b.hp})`);
}

// --- 32. 盗賊のスキルは防御を無視する ---
{
  const { state, me } = fresh();
  setJob(me, 'rogue');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const wall = putMonster(state, 'tanky', 'slime', { x: me.pos.x + 1, y: me.pos.y }, {
    hp: 60,
    maxHp: 60,
    atk: 0,
    def: 99,
  });
  turn(state, { type: 'skill', skillId: 'backstab' });
  const power = effectiveAtk(state, me);
  assert(
    wall.hp === 60 - power,
    `きゅうしょづきは防御99でも攻撃力ぶん通る (${60 - wall.hp} ダメージ / 攻撃力 ${power})`,
  );
}

// --- 33. スキルは待ち時間が明けるまで使えない ---
{
  const { state, me } = fresh();
  setJob(me, 'rogue');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const target = putMonster(state, 'cd', 'slime', { x: me.pos.x + 1, y: me.pos.y }, {
    hp: 99,
    maxHp: 99,
    atk: 0,
    def: 99,
  });
  turn(state, { type: 'skill', skillId: 'backstab' });
  const afterFirst = target.hp;
  turn(state, { type: 'skill', skillId: 'backstab' });
  assert(target.hp === afterFirst, `連続では撃てない (${afterFirst} → ${target.hp})`);
}

// --- 34. 空振りしたスキルは待ち時間を使わない ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  turn(state, { type: 'skill', skillId: 'cleave' }); // 隣に敵がいない
  assert(
    (me.cooldowns.cleave ?? 0) <= state.turn,
    '敵がいないときに撃っても待ち時間にならない',
  );
}

// --- 35. 出現位置の上に階段が置かれない（置かれると1歩も歩かず降りられる）---
{
  let onStairs = 0;
  for (let depth = 1; depth <= 5; depth++) {
    for (let i = 0; i < 300; i++) {
      const floor = createFloor(depth);
      const spawn = spawnPos(floor);
      if (floor.tiles[spawn.y * floor.width + spawn.x] === 'stairs') onStairs++;
    }
  }
  assert(onStairs === 0, `1500 回生成して出現位置が階段になった回数 ${onStairs}`);
}

// --- 36. 気づいていない敵は不意打ちになり、そのターン殴り返してこない ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const spot = freeNeighbour(state, me);
  const foe = putMonster(state, 'sleeper', 'goblin', spot.pos, {
    hp: 99,
    maxHp: 99,
    atk: 50,
    def: 0,
    aware: false,
    // こちらを向いていない。背後を取られている状態
    facing: spot.dir === 'e' ? 'e' : 'w',
  });
  const hpBefore = me.hp;
  turn(state, { type: 'move', dir: spot.dir });

  // 協力モードのダメージは ±1 振れる（combat.ts）。通常の最大値を超えていれば2倍が効いている。
  // 装備は袋に入っている間だけ効くので、素の atk ではなく実効値で見る
  const dealt = 99 - foe.hp;
  const power = effectiveAtk(state, me);
  const normalMax = power + 1;
  assert(
    dealt >= (power - 1) * 2 && dealt > normalMax,
    `不意打ちは2倍 (${dealt} / 通常の最大 ${normalMax})`,
  );
  assert(me.hp === hpBefore, `不意打ちしたターンは殴り返されない (HP ${hpBefore} → ${me.hp})`);
  assert(foe.aware, '殴られた敵は気づく');
}

// --- 37. 気づいている敵は普通に殴り返してくる ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const spot = freeNeighbour(state, me);
  putMonster(state, 'awake', 'goblin', spot.pos, {
    hp: 99,
    maxHp: 99,
    atk: 9,
    def: 0,
    aware: true,
  });
  const hpBefore = me.hp;
  turn(state, { type: 'move', dir: spot.dir });
  assert(me.hp < hpBefore, `気づいている敵は反撃する (HP ${hpBefore} → ${me.hp})`);
}

// --- 38. 背後は見えない。正面に立つと気づかれる ---
{
  const { state, me } = fresh();
  state.actors = state.actors.filter((a) => a.kind === 'player');
  // 東を向いた敵の、西隣（＝真後ろ）に立つ
  const foe = putMonster(
    state,
    'back',
    'goblin',
    { x: me.pos.x + 1, y: me.pos.y },
    { aware: false, facing: 'e', atk: 0 },
  );
  // 向きを変えられると試験にならないので、patrol が振り向かない形で確かめる。
  // 1ターンだけ見る
  const before = foe.aware;
  resolveTurn(state, new Map<string, Intent>([['p1', { type: 'wait' }]]));
  assert(!before, '最初は気づいていない');

  // 正面（東側）に回り込ませる
  foe.aware = false;
  foe.facing = 'e';
  me.pos = { x: foe.pos.x + 1, y: foe.pos.y };
  resolveTurn(state, new Map<string, Intent>([['p1', { type: 'wait' }]]));
  assert(foe.aware, '正面に立つと気づかれる');
}

// --- 39. かげがくれ中は気づかれない ---
{
  const { state, me } = fresh();
  setJob(me, 'rogue');
  me.skills.push('vanish');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const foe = putMonster(
    state,
    'blind',
    'goblin',
    { x: me.pos.x + 1, y: me.pos.y },
    { aware: true, atk: 0, facing: 'w' },
  );
  turn(state, { type: 'skill', skillId: 'vanish' });
  assert(!foe.aware, 'かげがくれで追ってきた敵が見失う');

  turn(state, { type: 'wait' });
  assert(!foe.aware, '隠れている間は正面にいても気づかれない');
}

// --- 40. 毒は毎ターン減らす ---
{
  const { state, me } = fresh();
  setJob(me, 'rogue');
  me.skills.push('venom');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const spot = freeNeighbour(state, me);
  const foe = putMonster(state, 'poisoned', 'slime', spot.pos, {
    hp: 99,
    maxHp: 99,
    atk: 0,
    def: 99,
    aware: true,
  });
  turn(state, { type: 'skill', skillId: 'venom' });
  const afterCast = foe.hp;
  turn(state, { type: 'wait' });
  turn(state, { type: 'wait' });
  assert(
    foe.hp < afterCast,
    `毒は防御99でも毎ターン減らす (${afterCast} → ${foe.hp})`,
  );
}

// --- 41. こおりのやりを受けた敵は動けない ---
{
  const { state, me } = fresh();
  setJob(me, 'mage');
  me.skills.push('frost');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  const foe = putMonster(
    state,
    'frozen',
    'goblin',
    { x: me.pos.x + 1, y: me.pos.y },
    { hp: 99, maxHp: 99, atk: 50, aware: true, facing: 'w' },
  );
  turn(state, { type: 'skill', skillId: 'frost' });
  const hpBefore = me.hp;
  turn(state, { type: 'wait' });
  assert(me.hp >= hpBefore - 1, `凍った敵は殴ってこない (HP ${hpBefore} → ${me.hp})`);
  assert(
    foe.pos.x === me.pos.x + 1 && foe.pos.y === me.pos.y,
    '凍った敵は動かない',
  );
}

// --- 42. 覚えていないわざは使えない ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  const before = state.log.length;
  turn(state, { type: 'skill', skillId: 'frost' }); // 魔法使いのわざ
  assert(
    (me.cooldowns.frost ?? 0) <= state.turn,
    '覚えていないわざを送っても何も起きない',
  );
  void before;
}

// --- 43. レベルアップのカードは自分の職業のものしか出ない ---
{
  const { state, me } = fresh();
  setJob(me, 'mage');
  for (let i = 0; i < 6 && me.level < MAX_LEVEL; i++) {
    awardExp(state, expToNext(me.level));
    const wrongJob = me.offers.filter((id) => {
      const job = perkOf(id).job;
      return job !== undefined && job !== 'mage';
    });
    assert(wrongJob.length === 0, `他の職業のカードが出ない (${wrongJob.join(',')})`);
    if (me.offers.length > 0) takePerk(state, me, me.offers[0]);
  }
}

// --- 44. わざを覚えるカードを取ると、実際に使えるようになる ---
{
  const { state, me } = fresh();
  setJob(me, 'cleric');
  me.pendingLevels = 1;
  me.offers = ['learn_smite'];
  takePerk(state, me, 'learn_smite');
  assert(me.skills.includes('smite'), 'さばきを覚える');

  state.actors = state.actors.filter((a) => a.kind === 'player');
  const spot = freeNeighbour(state, me);
  const foe = putMonster(state, 'judged', 'goblin', spot.pos, {
    hp: 99,
    maxHp: 99,
    atk: 0,
    aware: true,
  });
  turn(state, { type: 'skill', skillId: 'smite' });
  assert(foe.hp < 99, `覚えたわざが使える (${99 - foe.hp} ダメージ）`);
}

// --- 45. 袋は形で詰まる。数ではない ---
{
  const { state } = fresh();
  state.items = [];
  // 盾は 2x2。5x4 = 20 マスなので 5 個でちょうど埋まり、6 個目は入らない
  let placed = 0;
  for (let i = 0; i < 8; i++) {
    const item: ItemInstance = {
      id: `sh${i}`,
      itemId: 'shield',
      pos: null,
      ownerId: null,
      at: null,
      rot: 0,
    };
    state.items.push(item);
    if (putIn(state, 'p1', item)) placed++;
  }
  /*
   * 4個。5マス幅に 2x2 を並べると 2個で 4マス使い、右に1列あまる。
   * あまった 1 列（4マス）には 2x2 が入らない。
   * **これが形で詰める仕組みの肝**で、数の制限では起きない。
   * 「20マスあるのに盾は4つまで」が成立する。
   */
  assert(placed === 4, `2x2 の盾は 4 個で頭打ち (${placed} 個入った)`);
  assert(
    usedCells(state, 'p1') === 16,
    `16 マス埋まり、右の1列が余る (${usedCells(state, 'p1')})`,
  );

  // 余った1列には細いものが入る
  const thin: ItemInstance = {
    id: 'thin', itemId: 'potion', pos: null, ownerId: null, at: null, rot: 0,
  };
  state.items.push(thin);
  assert(putIn(state, 'p1', thin), '余った列には 1x1 が入る');
}

// --- 46. 入らない向きのものは回して入れる ---
{
  const { state } = fresh();
  state.items = [];
  let placed = 0;
  for (let i = 0; i < 8; i++) {
    const item: ItemInstance = {
      id: `sw${i}`,
      itemId: 'sword',
      pos: null,
      ownerId: null,
      at: null,
      rot: 0,
    };
    state.items.push(item);
    if (putIn(state, 'p1', item)) placed++;
  }
  const sideways = state.items.filter((i) => i.ownerId === 'p1' && i.rot === 1).length;
  assert(placed >= 5, `縦3の剣が ${placed} 本入った`);
  assert(sideways > 0, `そのままで入らない分は回して入れる (${sideways} 本が横向き)`);
}

// --- 47. 重ねて置けない ---
{
  const { state } = fresh();
  state.items = [];
  const a = putItem(state, 'ov-a', 'shield', { owner: 'p1' });
  const b = putItem(state, 'ov-b', 'potion', { owner: 'p1' });
  assert(a.at !== null && b.at !== null, '2つとも袋に入った（前提）');
  const ok = rearrangeItem(state, 'p1', 'ov-b', { x: a.at?.x ?? 0, y: a.at?.y ?? 0 }, 0);
  assert(!ok, '埋まっているマスには置けない');
}

// --- 48. 袋からはみ出す場所には置けない ---
{
  const { state } = fresh();
  state.items = [];
  putItem(state, 'edge', 'sword', { owner: 'p1' });
  const ok = rearrangeItem(state, 'p1', 'edge', { x: 0, y: BAG_H - 1 }, 0);
  assert(!ok, `縦3のものを下端に置こうとしても入らない (BAG_H=${BAG_H})`);
}

// --- 49. 袋が満杯なら拾わない ---
{
  const { state, me } = fresh();
  clearFloor(state);
  // 盾4個（16マス）＋ 薬草4個（余った1列）で 20 マスちょうど埋める
  for (let i = 0; i < 4; i++) {
    for (const itemId of ['shield', 'potion'] as const) {
      const item: ItemInstance = {
        id: `fill-${itemId}-${i}`,
        itemId,
        pos: null,
        ownerId: null,
        at: null,
        rot: 0,
      };
      state.items.push(item);
      putIn(state, 'p1', item);
    }
  }
  assert(usedCells(state, 'p1') === 20, `満杯にした (${usedCells(state, 'p1')}/20)`);
  const spot = freeNeighbour(state, me);
  putItem(state, 'nope', 'potion', { pos: spot.pos });
  turn(state, { type: 'move', dir: spot.dir });
  const left = state.items.find((i) => i.id === 'nope');
  assert(
    left !== undefined && left.ownerId === null,
    '満杯のときは乗っても拾わず、床に残る',
  );
}

// --- 50. あきらめると、その人だけが抜ける ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');
  clearFloor(state);
  putItem(state, 'it-keep', 'potion', { owner: 'p1' });

  // GameRoom の 'retire' がやることと同じ
  me.alive = false;
  me.hp = 0;
  retireCleanup(state);

  // 1人の「あきらめる」で全員の潜行を終わらせない
  assert(state.phase === 'playing', `仲間が残っていれば続く (${state.phase})`);
  assert(mate.alive, '仲間は巻き込まれない');
  // 持ち帰れるのは踏破したときだけ。去る人の荷物は床に落ちる
  const left = state.items.find((i) => i.id === 'it-keep');
  assert(
    left !== undefined && left.ownerId === null && left.pos !== null,
    '去った人の持ち物は床に落ちる',
  );
}

// --- 51. 1人なら、あきらめた時点で終わる ---
{
  const { state, me } = fresh();
  me.alive = false;
  me.hp = 0;
  me.left = true;
  retireCleanup(state);
  assert(state.phase === 'lost', `1人であきらめると終わる (${state.phase})`);
  // 自分で帰ったのに「全滅」と出すと、負かされた気分になる
  assert(state.lostBy === 'left', `終わり方は「引き返した」 (${state.lostBy})`);
}

// --- 52. 倒れて終わったときは「全滅」のまま ---
{
  const { state, me } = fresh();
  me.alive = false;
  me.hp = 0;
  retireCleanup(state);
  assert(state.lostBy === 'dead', `倒れたなら「全滅」 (${state.lostBy})`);
}

// --- 53. 起こされたら「去った」印が消える ---
{
  const { state, me } = fresh();
  addPlayer(state, 'p2');
  const mate = state.actors.find((a) => a.id === 'p2');
  if (!mate) throw new Error('no mate');
  mate.pos = freeNeighbour(state, me).pos;
  mate.alive = false;
  mate.hp = 0;
  mate.left = true;

  turn(state, { type: 'revive' });
  // 印が残ると、そのあと倒れても「引き返した」と出てしまう。
  // 代入のあとなので、型を狭められないよう配列から取り直す
  const after = state.actors.find((a) => a.id === 'p2');
  assert(after?.alive === true && after.left !== true, '起こされたら印が消える');
}

// --- 54. チュートリアルは毎回まったく同じ ---
{
  const a = createInitialGame('tutorial');
  const b = createInitialGame('tutorial');
  assert(
    a.floor.tiles.join('') === b.floor.tiles.join(''),
    '地形が毎回同じ（ランダムだと「次はここで殴る」と教えられない）',
  );
  const pos = (g: GameState) =>
    [...g.actors, ...g.items]
      .map((e) => ('pos' in e && e.pos ? `${e.pos.x},${e.pos.y}` : ''))
      .join('|');
  assert(pos(a) === pos(b), '敵とアイテムの位置も毎回同じ');

  const monsters = a.actors.filter((x) => x.kind === 'monster');
  assert(monsters.length === 1, `敵はコウモリ1匹だけ (${monsters.length})`);
  assert(monsters[0]?.speciesId === 'bat', '一番弱い敵を置く');
}

// --- 55. チュートリアルの持ち物は通り道の上にある ---
{
  const state = createInitialGame('tutorial');
  addPlayer(state, 'p1');
  startGame(state);
  const me = state.actors.find((x) => x.id === 'p1');
  if (!me) throw new Error('no player');

  const at = (itemId: string) => state.items.find((i) => i.itemId === itemId && i.pos)?.pos;
  const potion = at('potion');
  const sword = at('sword');

  /*
   * 部屋の真ん中に置いていたときは、端を歩いて踏まずに抜けられた。
   * そうなると「薬草を拾え」と出たまま先へ進めない。
   * 右上→右下は (9,6) の1マスしか無いので、その真下に置いてある。
   */
  assert(potion?.x === 9 && potion.y === 7, `薬草は降り口の真下 (${potion?.x},${potion?.y})`);
  assert(sword?.x === 5 && sword.y === 9, `剣は左下へ入って最初のマス (${sword?.x},${sword?.y})`);

  // 出発点に何も置かない。最初の1歩の前に拾ってしまうと順番が崩れる
  assert(
    !state.items.some((i) => i.pos && i.pos.x === me.pos.x && i.pos.y === me.pos.y),
    '出発点には何も置かない',
  );

  // 1階しかない。降りたら踏破
  assert(dungeonOf('tutorial').depth === 1, '1階で終わり');

  /*
   * Tutorial.tsx の1歩目は「x > 6 なら部屋を出た」で判定している。
   * 地図を描き替えて仕切りの位置が変わると、
   * **最初の指示が出たまま進まなくなる。** 気づけるようにここで縛る。
   */
  const f = state.floor;
  const wallCol = (x: number) =>
    [1, 2, 4, 5].every((y) => f.tiles[y * f.width + x] === 'wall');
  assert(wallCol(6), '左右の部屋を分ける壁は x=6（Tutorial.tsx の1歩目の判定）');
  assert(f.tiles[3 * f.width + 6] === 'floor', 'その壁の通り道は y=3');
}

// --- 56. 横に歩くと向きが変わる ---
{
  const { state, me } = fresh();
  clearFloor(state);
  assert(me.facing === 'e', `最初は右を向く (${me.facing})`);

  const west = { x: me.pos.x - 1, y: me.pos.y };
  if (tileAt(state.floor, west.x, west.y) !== 'wall') {
    turn(state, { type: 'move', dir: 'w' });
    assert(me.facing === 'w', `左へ歩くと左を向く (${me.facing})`);
  }

  /*
   * 上下も覚える。前・後ろ・横の絵が揃っているので、
   * 北を向いたら後ろ姿を出せる。
   */
  turn(state, { type: 'move', dir: 'n' });
  assert(me.facing === 'n', `上へ歩くと北を向く (${me.facing})`);
}

// --- 57. 歩いている間に足のコマが入れ替わる ---
{
  /*
   * 3D の盤は毎コマ rAF で描いている。確認に使うブラウザのペインが
   * 隠れていると rAF が呼ばれず、画面が止まったまま動かない。
   * それを「ループが死んでいる」と読み違えて3回書き直した。
   * 計算をここで確かめられるようにして、目で見るのは仕上げだけにする。
   */
  const steps = new Set<number>();
  for (let i = 0; i < 20; i++) steps.add(motionAt('moved', i / 20, 1, 0).step);
  assert(steps.size === 2, `1歩のあいだに足が入れ替わる (${[...steps].join(',')})`);

  /*
   * **入れ替わるのは1回だけ。**
   * 0.32 秒で4回入れ替えていたら、秒間12コマで足だけが震えて
   * 歩きではなく痙攣に見えた。1マス＝1歩なのだから1回でいい。
   */
  let swaps = 0;
  let last = motionAt('moved', 0, 1, 0).step;
  // t=1 は「終わった」を返すので数に入れない
  for (let i = 1; i < 40; i++) {
    const now = motionAt('moved', i / 40, 1, 0).step;
    if (now !== last) swaps++;
    last = now;
  }
  assert(swaps === 1, `踏み替えは1マスに1回 (${swaps} 回)`);

  // 滑り込み。始まりは1マス後ろ、終わりは到着している
  const a = motionAt('moved', 0, 1, 0);
  assert(Math.abs(a.dx + 1) < 0.01, `出だしは1マス後ろ (${a.dx.toFixed(2)})`);
  const b = motionAt('moved', 0.999, 1, 0);
  assert(Math.abs(b.dx) < 0.02, `着いたらずれが無い (${b.dx.toFixed(3)})`);
  assert(motionAt('moved', 1, 1, 0).done, '1 を超えたら終わり');

  // 跳ねて見えない程度。上下は小さく
  let lift = 0;
  for (let i = 0; i <= 20; i++) lift = Math.max(lift, motionAt('moved', i / 20, 1, 0).dy);
  assert(lift > 0 && lift < 0.1, `上下は控えめ (${lift.toFixed(3)})`);
}

// --- 58. 殴る・被弾・消えるの形 ---
{
  /*
   * 剣を振る。引いてから出す。
   * 山なりに行って帰るだけだと、0.3秒ずっと同じ絵で「振った」に見えなかった。
   */
  const wind = motionAt('lunge', 0.2, 1, 0);
  assert(wind.dx < -0.1, `まず引く (${wind.dx.toFixed(2)})`);
  assert(wind.step === 0, '引いている間は構えの絵');

  const strike = motionAt('lunge', 0.55, 1, 0);
  assert(strike.dx > 0.4, `そこから出る (${strike.dx.toFixed(2)})`);
  assert(strike.step === 1, '出たら斬る絵');

  const home = motionAt('lunge', 0.99, 1, 0);
  assert(Math.abs(home.dx) < 0.05, `最後は戻る (${home.dx.toFixed(3)})`);

  // 引きと出のコマが両方出る。片方だけだと振って見えない
  const swings = new Set<number>();
  for (let i = 0; i < 20; i++) swings.add(motionAt('lunge', i / 20, 1, 0).step);
  assert(swings.size === 2, '振りかぶりと振り抜きの2コマが出る');

  // 被弾は白く飛んですぐ戻る
  assert(motionAt('hit', 0, 0, 0).glow > 0.5, '殴られた瞬間は白い');
  assert(motionAt('hit', 0.5, 0, 0).glow === 0, 'すぐ戻る');

  // 消えるときは沈んで薄くなる
  const d = motionAt('die', 0.8, 0, 0);
  assert(d.fade < 0.3 && d.dy < 0, `消えぎわは沈んで薄い (${d.fade.toFixed(2)})`);

  /*
   * 速さ。3D にしたら 2D 版と同じ長さでは速すぎた（実機で確認）。
   * マスが大きくなり、奥行き方向にも動くぶん、追う目の仕事が増えている。
   * ここを縮めると、また「速すぎる」に戻る。
   */
  assert(DURATION.moved > 0.4, `歩きはゆっくり (${DURATION.moved} 秒)`);
  assert(DURATION.lunge < DURATION.moved, '殴りは歩きより短い（鋭く見せる）');
  assert(DURATION.die > DURATION.hit, '消えるのは一番ゆっくり');

  /*
   * 殴り方は種族で変える。全部同じだと、何に殴られたのか動きで分からない。
   */
  // コウモリは二度噛み。出る山が2つある
  let peaks = 0;
  let prev = 0;
  let rising = false;
  for (let i = 0; i <= 40; i++) {
    const v = motionAt('lunge', i / 40, 1, 0, 'bite').dx;
    if (v > prev && !rising) rising = true;
    if (v < prev && rising) {
      peaks++;
      rising = false;
    }
    prev = v;
  }
  assert(peaks === 2, `コウモリは二度噛む (山 ${peaks} 個)`);

  // スライムは潰れてから伸びる
  const flat2 = motionAt('lunge', 0.3, 1, 0, 'squish');
  assert(flat2.sy < 0.8 && flat2.sx > 1.2, `スライムは潰れる (${flat2.sx.toFixed(2)}x${flat2.sy.toFixed(2)})`);
  assert(motionAt('lunge', 0.5, 1, 0, 'slam').sy === 1, '剣を振るときは潰れない');
}

// --- 59. わざの演出が全部のわざに用意されている ---
{
  for (const id of SKILL_IDS) {
    assert(FX[id] !== undefined, `${id} の見た目がある`);
  }

  // 斬る系は現れて消える。出しっぱなしにならない
  const s0 = fxAt('slash', 0);
  const sMid = fxAt('slash', 0.3);
  const sEnd = fxAt('slash', 0.99);
  assert(s0.fade < 0.1 && sMid.fade > 0.9 && sEnd.fade < 0.1, '斬撃は現れて消える');
  assert(fxAt('slash', 1).fade === 0, '終わったら残らない');

  // 輪は広がりながら薄れる
  const r1 = fxAt('ring', 0.2);
  const r2 = fxAt('ring', 0.8);
  assert(r2.scale > r1.scale && r2.fade < r1.fade, '輪は広がって薄れる');
}

// --- 60. パスワードの保管と検証 ---
/*
 * ここは思いつきで書いてはいけないところなので、試験も厚くしてある。
 * 暗号そのものは Node 標準の scrypt。自作しているのは
 * パラメータの選び方と、比較の仕方だけ。
 */
{
  const h = await hashPassword('correct horse battery');
  assert(!h.includes('correct'), '保管値に生のパスワードが入っていない');
  assert(h.startsWith('scrypt$16384$8$1$'), `形式が自己記述 (${h.slice(0, 18)})`);

  assert(await verifyPassword('correct horse battery', h), '正しいパスワードは通る');
  assert(!(await verifyPassword('correct horse batter', h)), '1文字違うと通らない');
  assert(!(await verifyPassword('', h)), '空は通らない');

  // 塩。これが無いと、1つ破られたら同じパスワードの人が全員破られる
  const h2 = await hashPassword('correct horse battery');
  assert(h !== h2, '同じパスワードでも保管値が違う（塩が効いている）');
  assert(await verifyPassword('correct horse battery', h2), 'もう一方の保管値でも通る');

  // 壊れた保管値で落ちたり、巨大な計算をさせられたりしない
  for (const bad of [
    '',
    'x',
    'scrypt$a$b$c$d$e',
    'scrypt$16384$8$1$$',
    'bcrypt$1$2$3$4$5',
    'scrypt$99999999$8$1$AAAA$AAAA',
  ]) {
    assert((await verifyPassword('x', bad)) === false, `壊れた保管値を拒む (${bad.slice(0, 16) || '空'})`);
  }

  // 見た目が同じものは同じ扱いにする（全角と半角で入れ直せなくなるのを防ぐ）
  const hk = await hashPassword('ｐassword123');
  assert(await verifyPassword('ｐassword123', hk), '全角を含むパスワードも一致する');
}

// --- 61. 名前とパスワードの決まり ---
{
  assert(isValidLoginName('shuri_01'), '英数と記号の名前は通る');
  assert(!isValidLoginName('ab'), '短すぎる名前は弾く');
  assert(!isValidLoginName('しゅり'), '日本語の名前は弾く（表示名とは別）');
  assert(!isValidLoginName('a b'), '空白入りは弾く');

  assert(passwordProblem('short') !== null, '短いパスワードは理由つきで弾く');
  assert(passwordProblem('a'.repeat(500)) !== null, '長すぎるパスワードも弾く');
  assert(passwordProblem('longenough1') === null, '足りていれば通す');
}

// --- 62. 合い言葉と総当たり対策 ---
{
  const t1 = newSessionToken();
  const t2 = newSessionToken();
  assert(t1.token !== t2.token, '合い言葉は毎回違う');
  assert(t1.token.length >= 40, `合い言葉が十分長い (${t1.token.length} 文字)`);
  /*
   * 生のまま保管しない。保管庫が漏れたとき、生の合い言葉が入っていると
   * そのまま全員になりすませる。
   */
  assert(!t1.digest.includes(t1.token), '保管するのは要約で、生の値ではない');
  assert(digestToken(t1.token) === t1.digest, '同じ合い言葉からは同じ要約');

  assert(lockoutMs(0) === 0 && lockoutMs(2) === 0, '2回までは待たされない');
  assert(lockoutMs(3) > 0, '3回外すと待たされる');
  assert(lockoutMs(10) > lockoutMs(5), '外すほど待ち時間が伸びる');
  /*
   * 完全に締め出さない。締め出せると、他人がわざと外して
   * 本人を閉め出す嫌がらせができてしまう。
   */
  assert(lockoutMs(100) <= 15 * 60 * 1000, '待ち時間に上限がある（締め出されない）');
}

// --- 63. 登録とログイン ---
{
  const acc = makeAccounts(memoryStore());

  const made = await acc.register('shuri_01', 'longenough1', '{"lv":1}');
  assert(made.ok, '登録できる');
  if (!made.ok) throw new Error('登録に失敗');

  const again = await acc.register('SHURI_01', 'another12345', '');
  assert(!again.ok, '同じ名前は大文字小文字を変えても取れない');

  const inOk = await acc.login('shuri_01', 'longenough1');
  assert(inOk.ok, 'ログインできる');
  assert(inOk.ok && inOk.save === '{"lv":1}', '登録時の持ち物が戻ってくる');

  /*
   * **「その名前は無い」と「パスワードが違う」を区別しない。**
   * 区別すると、名前を総当たりして誰が登録しているか調べられる。
   */
  const wrongPw = await acc.login('shuri_01', 'wrongpassword');
  const noName = await acc.login('nobody_here', 'wrongpassword');
  assert(!wrongPw.ok && !noName.ok, 'どちらも失敗する');
  assert(
    !wrongPw.ok && !noName.ok && wrongPw.message === noName.message,
    `同じ文言で返す（${!wrongPw.ok ? wrongPw.message : ''}）`,
  );

  // 合い言葉で持ち主を引ける
  const who = await acc.whoIs(inOk.ok ? inOk.token : '');
  assert(who?.login === 'shuri_01', '合い言葉から持ち主が分かる');
  assert((await acc.whoIs('でたらめ')) === null, 'でたらめな合い言葉は通らない');
  assert((await acc.whoIs('')) === null, '空の合い言葉は通らない');
}

// --- 64. 保存とパスワード変更 ---
{
  const acc = makeAccounts(memoryStore());
  const made = await acc.register('tester', 'longenough1', '');
  if (!made.ok) throw new Error('登録に失敗');
  const token = made.token;

  assert(await acc.save(token, '{"lv":9}'), '持ち物を保存できる');
  const back = await acc.whoIs(token);
  assert(back?.save === '{"lv":9}', '保存した持ち物が戻る');
  assert(!(await acc.save('でたらめ', 'x')), 'でたらめな合い言葉では保存できない');

  // いまのパスワードを知らないと変えられない
  const nope = await acc.changePassword(token, 'wrongone123', 'newpassword1');
  assert(!nope.ok, 'いまのパスワードが違うと変えられない');

  const done = await acc.changePassword(token, 'longenough1', 'newpassword1');
  assert(done.ok, 'パスワードを変えられる');

  /*
   * **変えたら古い合い言葉は全部切る。**
   * 変える理由はたいてい「誰かに知られた」なので、
   * 古い合い言葉が生きていては意味がない。
   */
  assert((await acc.whoIs(token)) === null, '古い合い言葉は切れる');
  assert(done.ok && (await acc.whoIs(done.token))?.login === 'tester', '新しい合い言葉は効く');

  assert((await acc.login('tester', 'longenough1')).ok === false, '古いパスワードでは入れない');
  assert((await acc.login('tester', 'newpassword1')).ok === true, '新しいパスワードで入れる');
}

// --- 65. 続けて間違えると待たされる ---
{
  const acc = makeAccounts(memoryStore());
  await acc.register('locked', 'longenough1', '');
  for (let i = 0; i < 4; i++) await acc.login('locked', 'badguess1234');

  const after = await acc.login('locked', 'longenough1');
  assert(
    !after.ok && after.message.includes('待つ'),
    `正しくても待たされる (${!after.ok ? after.message : ''})`,
  );
}

// --- 66. 記録の持ち運び（carry.ts） ---
{
  /*
   * carry.ts はブラウザの localStorage を触る。
   * node には無いので、同じ形の偽物を置いて試す。
   * **置き場所が違うだけで、運ぶ判断は同じ**なので、これで意味がある。
   */
  const bag = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  };

  assert(isEmptyDump(localDump()), '何も無ければ空');

  bag.set('roguelike:stash', '["sword"]');
  bag.set('roguelike:tutorial-done', '1');
  // 運ばない鍵。合い言葉を一緒に運ぶと、記録を渡した相手が本人になれる
  bag.set('roguelike:token', 'ひみつ');

  const dump = localDump();
  assert(!isEmptyDump(dump), '記録があれば空ではない');
  assert(dump['roguelike:stash'] === '["sword"]', '倉庫を運ぶ');
  assert(dump['roguelike:tutorial-done'] === '1', 'チュートリアル済みも運ぶ');
  assert(!('roguelike:token' in dump), '合い言葉は運ばない');
  assert(
    !(CARRY_KEYS as readonly string[]).includes('roguelike:token'),
    '運ぶ鍵に合い言葉を入れていない',
  );

  // 書き戻すのは知っている鍵だけ。知らない鍵を書くと身に覚えのない値が残る
  bag.clear();
  const wrote = applyDump({ 'roguelike:stash': '["shield"]', 'roguelike:evil': 'x', bad: 1 });
  assert(wrote === 1, '知っている鍵だけ書き戻す');
  assert(bag.get('roguelike:stash') === '["shield"]', '書き戻せている');
  assert(!bag.has('roguelike:evil'), '知らない鍵は書かない');

  assert(applyDump('ただの文字') === 0, '壊れた記録で落ちない');
  assert(applyDump(null) === 0, '空でも落ちない');
}

// --- 67. ぶつかった記録の見分け ---
{
  /*
   * 「アカウントの記録」と言われても選べない。
   * **何回潜ったか・何階まで・倉庫に何個**が出れば選べる。
   */
  const said = describeDump({
    'roguelike:profile': JSON.stringify({ name: 'しゅり', runs: 12, deepest: 7 }),
    'roguelike:stash': '["a","b","c"]',
  });
  assert(said.startsWith('しゅり'), 'まず名前が出る');
  assert(said.includes('12回'), 'もぐった回数が出る');
  assert(said.includes('B7F'), '一番深い階が出る');
  assert(said.includes('3個'), '倉庫の数が出る');
  assert(describeDump({}) === '記録あり', '中身が無くても何か言う');
  assert(describeDump({ 'roguelike:profile': '壊れている' }).length > 0, '壊れた記録でも落ちない');
}

// ============================================================
//  対戦（2vs2 PvP）の土台 — 03_改善構成.md 段階D D2〜D6
//
//  D2 と D3 は「見た目の変化がゼロ」が正しさの定義なので、
//  **変化ゼロを試験にしないと、壊れたことに気づけない。**
//  以下の試験の半分は「協力モードが1マスも変わっていない」の確認。
// ============================================================

/** 対戦の盤を1つ作る。人間は p1（戦士）、空いた席は AI */
function freshVersus(): { state: GameState; me: Actor; bot: Actor } {
  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  chooseJob(state, 'p1', 'warrior');
  fillWithBots(state);
  startGame(state);
  updateVision(state);
  const me = state.actors.find((a) => a.id === 'p1');
  const bot = state.actors.find((a) => a.bot === true);
  if (!me || !bot) throw new Error('versus setup failed');
  return { state, me, bot };
}

/**
 * コメントを落としたソース。
 * 「ここに Math.random は無い」と書いたコメント自体に
 * 引っかかって落ちたので、コメントは外して見る。
 */
function codeOf(file: string): string {
  return readFileSync(`./src/server/${file}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** 見えているか。チームごとの視界を直に引く */
function sees(state: GameState, team: 'A' | 'B', p: Pos): boolean {
  return visionOf(state.floor, team).visible[p.y * state.floor.width + p.x] === true;
}

// --- 68. D2 送信を1人ずつに。協力モードは変化ゼロ ---
{
  /*
   * publish を broadcast から client.send のループに替えた（GameRoom）。
   * 替えただけでは中身が変わってはいけない。
   * **同じオブジェクトが返ること**を試験にしておけば、
   * この先どれだけ対戦側を足しても協力モードは巻き込まれない。
   */
  const { state } = fresh();
  assert(viewFor(state, 'A') === state, '協力では state をそのまま配る（削らない）');
  assert(viewFor(state, null) === state, 'チームの分からない人にもそのまま配る');
  assert(state.mode === 'coop', '既定は協力モード');
}

// --- 69. D3 視界をチームごとに。協力モードは変化ゼロ ---
{
  const state = createInitialGame();
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  startGame(state);
  updateVision(state);

  const p1 = state.actors.find((a) => a.id === 'p1');
  const p2 = state.actors.find((a) => a.id === 'p2');
  if (!p1 || !p2) throw new Error('players missing');

  assert(playerTeams(state).join(',') === 'A', '協力モードのチームは A だけ');

  // 2人を離して、互いの足元が両方見えていること（＝視界が1つに合わさっている）
  for (let y = state.floor.height - 2; y >= 1; y--) {
    let placed = false;
    for (let x = state.floor.width - 2; x >= 1; x--) {
      if (tileAt(state.floor, x, y) === 'floor') {
        p2.pos = { x, y };
        placed = true;
        break;
      }
    }
    if (placed) break;
  }
  updateVision(state);

  assert(sees(state, 'A', p1.pos) && sees(state, 'A', p2.pos), '協力は視界を共有する');
  const v = visionOf(state.floor, 'A');
  assert(
    state.floor.visible === v.visible && state.floor.seen === v.seen,
    'チームが1つなら、その視界がそのまま盤に載る',
  );

  // 誰もいない盤では、以前と同じく visible は空で seen は残る
  const empty = createInitialGame();
  empty.floor.seen[0] = true;
  updateVision(empty);
  assert(!empty.floor.visible.some(Boolean), 'プレイヤーがいなければ何も見えない');
  assert(empty.floor.seen[0] === true, 'プレイヤーがいなくても記憶は消さない');
}

// --- 70. D3 対戦では視界が分かれる ---
{
  const { state, me, bot } = freshVersus();

  assert(playerTeams(state).join(',') === 'A,B', '対戦は2チーム');
  assert(me.team === 'A' && bot.team === 'B', 'slot の順でチームが決まる');

  assert(sees(state, 'A', me.pos), '自分の足元は自分に見えている');
  assert(sees(state, 'B', bot.pos), '相手の足元は相手に見えている');
  // 鏡像の両端から始まるので、開幕は互いに見えていない
  assert(!sees(state, 'A', bot.pos), '開幕、相手の位置はこちらに見えていない');
  assert(!sees(state, 'B', me.pos), '開幕、こちらの位置は相手に見えていない');

  assert(
    !state.floor.visible.some(Boolean),
    '対戦では盤そのものに視界を載せない（差し替え損ねても漏れない側に倒す）',
  );
  assert(!state.floor.seen.some(Boolean), '記憶も盤には載せない');
}

// --- 71. D4 ログのスコープ ---
{
  const { state } = fresh();
  assert(state.log.length === state.logScope.length, 'ログと見せる相手は同じ長さ');

  // 20行の上限を越えても、2つの配列がずれない
  for (let i = 0; i < 40; i++) turn(state, { type: 'wait' });
  assert(state.log.length === state.logScope.length, '古い行を捨てても長さが揃っている');
  assert(
    state.logScope.every((t) => t === null || t === 'A'),
    '協力モードの行は全員向け（A と null しか出ない）',
  );

  // 対戦。片方の行動で出た行が、相手に渡らない
  const v = freshVersus();
  // 「息を整えた」は傷があるときだけ出る。1 削ってから待つ
  v.me.hp = v.me.maxHp - 1;
  v.state.log.length = 0;
  v.state.logScope.length = 0;
  resolveTurn(v.state, new Map<string, Intent>([['p1', { type: 'wait' }]]));

  const forA = viewFor(v.state, 'A').log;
  const forB = viewFor(v.state, 'B').log;
  assert(forA.includes('息を整えた'), '自分の行動のログは自分に届く');
  assert(!forB.includes('息を整えた'), '相手の行動のログは相手に届かない');
  assert(viewFor(v.state, 'A').logScope.length === 0, 'どの行が誰向けだったかは配らない');
}

// --- 72. D5 鏡像フロア ---
{
  const floor = createMirrorFloor();

  assert(floor.width % 2 === 0, '幅は偶数（半分を折り返すので）');

  let symmetric = true;
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      if (tileAt(floor, x, y) !== tileAt(floor, floor.width - 1 - x, y)) symmetric = false;
    }
  }
  assert(symmetric, '地形が左右で完全に同じ（地形の有利不利が抽選で決まらない）');
  assert(floor.rooms.length % 2 === 0, '部屋も左右で同じ数');
  assert(!floor.tiles.includes('stairs'), '対戦に階段は無い（相手を倒して決まる）');

  const a = arenaSpawn(floor, 'A');
  const b = arenaSpawn(floor, 'B');
  assert(a.x + b.x === floor.width - 1 && a.y === b.y, '出発点は互いの鏡');
  assert(a.x !== b.x, '出発点が重なっていない');

  // 片側からもう片側へ歩いて行けるか（中央の通路がつながっているか）
  const seen = new Set<number>([a.y * floor.width + a.x]);
  let front: Pos[] = [a];
  let reached = false;
  while (front.length > 0 && !reached) {
    const next: Pos[] = [];
    for (const at of front) {
      for (const dir of ['n', 'e', 's', 'w'] as Dir[]) {
        const d = DIR_DELTA[dir];
        const p = { x: at.x + d.x, y: at.y + d.y };
        if (tileAt(floor, p.x, p.y) === 'wall') continue;
        const i = p.y * floor.width + p.x;
        if (seen.has(i)) continue;
        seen.add(i);
        if (p.x === b.x && p.y === b.y) reached = true;
        next.push(p);
      }
    }
    front = next;
  }
  assert(reached, '自陣から相手の陣地へ歩いて行ける（中央がつながっている）');
}

// --- 73. D6 AI 相手の 1vs1 ---
{
  const { state, me, bot } = freshVersus();

  assert(
    state.actors.filter((a) => a.kind === 'player').length === VERSUS_PLAYERS,
    `対戦の席が埋まる（${VERSUS_PLAYERS}人）`,
  );
  assert(bot.bot === true, 'AI の駒には旗が立っている');
  assert(bot.kind === 'player', 'AI の駒もプレイヤーと同じ型（規則を書き写さない）');
  assert(bot.job === me.job, 'AI は相手と同じ職業（職業差が抽選で決まらない）');
  assert(bot.maxHp === me.maxHp && bot.atk === me.atk, '素の強さも同じ');

  // 同じ盤で2回呼んだら同じ手。乱数が入っていたら揺れる
  const first = JSON.stringify(botIntent(state, bot));
  let same = true;
  for (let i = 0; i < 30; i++) {
    if (JSON.stringify(botIntent(state, bot)) !== first) same = false;
  }
  assert(same, 'AI の手は決定論（同じ盤なら必ず同じ手）');

  // 隣に立たせたら殴る
  const spot = { x: bot.pos.x, y: bot.pos.y };
  for (const dir of ['n', 'e', 's', 'w'] as Dir[]) {
    const d = DIR_DELTA[dir];
    if (tileAt(state.floor, spot.x + d.x, spot.y + d.y) !== 'wall') {
      me.pos = { x: spot.x + d.x, y: spot.y + d.y };
      break;
    }
  }
  updateVision(state);
  const close = botIntent(state, bot);
  assert(
    close.type === 'move' || close.type === 'skill',
    `隣に相手がいたら殴るかわざを使う（${close.type}）`,
  );
}

// --- 74. D6 対戦に乱数が入っていない ---
{
  /*
   * 「運で負けた」が出たときに疑う順（03_改善構成.md 段階D）:
   *   (1) モンスターの乱数（patrol 以外に増えていないか）
   *   (3) attack に { pvp: false } が復活していないか
   * (1) と (3) をここで固める。(2)（ドラフト）は段階 D8。
   */
  const { state, me, bot } = freshVersus();

  // (3) 同じ条件で何回殴っても同じダメージ
  const dealt = new Set<number>();
  for (let i = 0; i < 40; i++) {
    bot.hp = bot.maxHp;
    attack(state, me, bot);
    dealt.add(bot.maxHp - bot.hp);
  }
  assert(dealt.size === 1, `対戦の殴りは確定値 (${[...dealt].join(' / ')})`);

  // 協力モードのほうは振れていること（確定にしてしまっていない）
  const coop = fresh();
  const foe = coop.state.actors.find((a) => a.kind === 'monster');
  if (foe) {
    const spread = new Set<number>();
    for (let i = 0; i < 80; i++) {
      foe.hp = foe.maxHp;
      attack(coop.state, coop.me, foe);
      spread.add(foe.maxHp - foe.hp);
    }
    assert(spread.size > 1, '協力モードの殴りは今も振れている');
  }

  // (1) 対戦ではモンスターがうろうろしない
  const vs = freshVersus();
  const mob = vs.state.actors.find((a) => a.kind === 'monster');
  assert(mob !== undefined, '対戦の盤にモンスターが置かれている');
  if (mob) {
    mob.aware = false;
    const was = { ...mob.pos };
    const facing = mob.facing;
    let moved = false;
    for (let i = 0; i < 40; i++) {
      monsterAct(vs.state, mob);
      vs.state.turn++;
      if (mob.pos.x !== was.x || mob.pos.y !== was.y || mob.facing !== facing) moved = true;
    }
    assert(!moved, '対戦では、見つけるまでモンスターが動かない');
  }

  // 協力モードのモンスターは今もうろうろする
  const c2 = fresh();
  const m2 = c2.state.actors.find((a) => a.kind === 'monster');
  if (m2) {
    m2.aware = false;
    const was = { ...m2.pos };
    const facing = m2.facing;
    let moved = false;
    for (let i = 0; i < 80; i++) {
      monsterAct(c2.state, m2);
      c2.state.turn++;
      if (m2.pos.x !== was.x || m2.pos.y !== was.y || m2.facing !== facing) moved = true;
    }
    assert(moved, '協力モードのモンスターは今もうろうろする');
  }

  // (3) ソースに書き下した { pvp: false } が残っていないか。
  //     既定値（pvpOf）に任せるのが正しい呼び方なので、1つでもあれば疑う
  const files = ['ai.ts', 'resolve.ts', 'skills.ts', 'effects.ts', 'duel.ts', 'levels.ts'];
  const written = files.filter((f) => /attack\([^;]*pvp:\s*false/.test(codeOf(f)));
  assert(
    written.length === 0,
    `attack に pvp:false が書き下されていない (${written.join(' / ')})`,
  );

  // AI の頭に乱数が無いか。ソースを読んで確かめる
  const duelSrc = codeOf('duel.ts');
  assert(!/Math\.random/.test(duelSrc), 'AI の頭に Math.random が無い');
  assert(
    !/from '\.\/random'/.test(duelSrc),
    'AI の頭が乱数の道具を読み込んでいない（randInt / pick / shuffle）',
  );
}

// --- 75. D6 通しで決着する ---
{
  /*
   * **合格条件そのもの。** 1vs1 が最後まで通ること。
   * 人間の側も AI と同じ頭で動かして、10回まわして全部決着するか見る。
   * 決着しない盤が混ざると、ブラウザで遊んだとき終わらない試合を引く。
   */
  let decided = 0;
  let longest = 0;
  for (let run = 0; run < 10; run++) {
    const { state, me } = freshVersus();
    let t = 0;
    while (state.phase === 'playing' && t < 300) {
      resolveTurn(state, new Map<string, Intent>([['p1', botIntent(state, me)]]));
      t++;
    }
    if (state.phase !== 'playing') decided++;
    longest = Math.max(longest, t);
  }
  assert(decided === 10, `10回とも決着する（${decided}/10、最長 ${longest} ターン）`);

  // 勝者と敗者で phase が分かれる
  const { state, bot } = freshVersus();
  bot.hp = 0;
  bot.alive = false;
  retireCleanup(state);
  assert(state.winner === 'A', '相手が倒れたらチーム A の勝ち');
  assert(viewFor(state, 'A').phase === 'won', '勝った側には won が届く');
  assert(viewFor(state, 'B').phase === 'lost', '負けた側には lost が届く');
  assert(state.phase === 'won', '盤そのものは winner を正とする');
}

// --- 76. D6 送っているものに相手の位置が入っていない ---
{
  /*
   * **ここが一番大事な試験。**
   * 視界を分けても、配る中身を削り忘れていれば画面に出ないだけで
   * 相手の位置はブラウザに届いている（コンソールで見える）。
   * だから「state を文字列にして、相手の座標が入っていないこと」を見る。
   */
  const { state, me, bot } = freshVersus();

  const forA = viewFor(state, 'A');
  const forB = viewFor(state, 'B');

  assert(!forA.actors.some((a) => a.id === bot.id), 'A の受け取る中身に相手の駒が無い');
  assert(!forB.actors.some((a) => a.id === me.id), 'B の受け取る中身にこちらの駒が無い');
  assert(forA.actors.some((a) => a.id === me.id), '自分の駒は届く');
  assert(
    forA.actors.every((a) => a.team === 'A' || sees(state, 'A', a.pos)),
    '届く駒は自陣か、見えているマスにいるものだけ',
  );

  // 床のアイテムも、見えているマスのものだけ
  assert(
    forA.items.every((i) => i.pos === null || sees(state, 'A', i.pos)),
    '床のアイテムは見えているマスのものだけ届く',
  );
  // 相手の袋の中身は届かない（装備から強さが読めてしまう）
  assert(
    forA.items.every((i) => {
      if (i.ownerId === null) return true;
      const owner = state.actors.find((a) => a.id === i.ownerId);
      return owner?.team === 'A';
    }),
    '相手の持ち物は届かない',
  );

  // 地形は隠さない（鏡像なので秘密情報ではない）。
  // ここを隠す作りにすると、タイル配列の部分マスクという温床ができる
  assert(
    forA.floor.tiles.length === state.floor.tiles.length,
    '地形は丸ごと届く（鏡像なので隠す意味が無い）',
  );

  // 実際に送る形（JSON）に相手の座標が含まれていないか
  const payload = JSON.stringify(forA);
  assert(!payload.includes(`"${bot.id}"`), '送る JSON に相手の id が入っていない');
  assert(
    !new RegExp(`"x":${bot.pos.x},"y":${bot.pos.y}`).test(payload),
    '送る JSON に相手の座標が入っていない',
  );
}

// --- 77. 協力モードが変わっていないこと（まとめ） ---
{
  /*
   * 段階 D2〜D5 は「協力モードの変化ゼロ」が正しさの定義。
   * 個別の試験は上に書いたが、**通しで1ランまわして**
   * 以前と同じように遊べることをここで押さえる。
   */
  const { state, me } = fresh();
  assert(state.mode === 'coop', '協力モードで始まる');

  const dirs: Dir[] = ['n', 'e', 's', 'w'];
  for (let i = 0; i < 30; i++) turn(state, { type: 'move', dir: dirs[i % 4] });

  assert(state.phase === 'playing' || state.phase === 'lost', '30ターン歩いても落ちない');
  assert(viewFor(state, 'A') === state, '協力は配る中身を削らない');
  assert(state.winner === undefined, '協力に勝者はいない');
  assert(me.team === 'A', '協力のプレイヤーはチーム A');
  assert(state.actors.filter((a) => a.bot).length === 0, '協力モードに AI の駒は入らない');
}

// --- 78. 殴り合いのログは殴った側と殴られた側の両方に届く ---
{
  /*
   * 実際に対戦を通しで遊んで見つけた穴。
   * ログを「行動した人のチーム」だけに絞ると、**殴られたほうには1行も出ず、
   * HP だけ減って理由が分からない。** 試験にしておかないと、
   * D7 以降でスコープを触ったときに同じ穴が戻る。
   */
  const { state, me, bot } = freshVersus();
  state.log.length = 0;
  state.logScope.length = 0;

  setLogScope('B'); // 相手の行動として殴らせる
  attack(state, bot, me);
  setLogScope(null);

  const toA = viewFor(state, 'A').log.join('\n');
  const toB = viewFor(state, 'B').log.join('\n');
  assert(toA.includes('ダメージ'), '殴られた側にもログが届く');
  assert(toB.includes('ダメージ'), '殴った側にもログが届く');
  assert(toA.includes(`${bot.slot}番 → ${me.slot}番`), '対戦ではプレイヤーを番号で呼ぶ');

  // 協力モードの文面は1文字も変わっていない
  const coop = fresh();
  const mob = coop.state.actors.find((a) => a.kind === 'monster');
  assert(mob !== undefined, '協力の盤にモンスターがいる');
  if (mob) {
    coop.state.log.length = 0;
    coop.state.logScope.length = 0;
    attack(coop.state, coop.me, mob);
    assert(
      coop.state.log.some((l) => /^冒険者 → .+ \d+ダメージ$/.test(l)),
      '協力モードのログの文面は変わっていない（種族の名前のまま）',
    );
  }
}

// --- 68. 中央の扉（段階D D7） ---
{
  /** from から to へ歩いて行けるか。幅優先。壁だけを見る */
  const reachable = (floor: Floor, from: Pos, to: Pos): boolean => {
    const seen = new Set<number>([from.y * floor.width + from.x]);
    let edge: Pos[] = [from];
    while (edge.length > 0) {
      const next: Pos[] = [];
      for (const at of edge) {
        for (const d of Object.values(DIR_DELTA)) {
          const p = { x: at.x + d.x, y: at.y + d.y };
          if (p.x < 0 || p.y < 0 || p.x >= floor.width || p.y >= floor.height) continue;
          const key = p.y * floor.width + p.x;
          if (seen.has(key)) continue;
          if (tileAt(floor, p.x, p.y) === 'wall') continue;
          if (p.x === to.x && p.y === to.y) return true;
          seen.add(key);
          next.push(p);
        }
      }
      edge = next;
    }
    return false;
  };

  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');

  const gate = state.gate;
  assert(gate !== undefined, '対戦の盤には扉がある');
  assert(gate !== undefined && gate.cells.length > 0, '扉のマスが決まっている');
  assert(gate !== undefined && !gate.open, '始めは閉じている');

  /*
   * **閉じているあいだ、扉のマスはタイルそのものが壁。**
   * 「通れないことにする」のではなく「通れない盤にする」ので、
   * 移動も視界も経路探索も、扉を知らないまま正しく動く。
   */
  const closed =
    gate !== undefined && gate.cells.every((c) => tileAt(state.floor, c.x, c.y) === 'wall');
  assert(closed, '閉じている間は壁になっている');

  // 左右が本当につながっていない
  assert(!reachable(state.floor, arenaSpawn(state.floor, 'A'), arenaSpawn(state.floor, 'B')),
    '閉じている間は相手の陣地へ行けない');

  // 15ターン経つと開く
  startGame(state);
  for (let i = 0; i < EXPLORE_TURNS; i++) resolveTurn(state, new Map());

  assert(state.gate?.open === true, `${EXPLORE_TURNS}ターンで開く`);
  const opened =
    state.gate !== undefined &&
    state.gate.cells.every((c) => tileAt(state.floor, c.x, c.y) === 'floor');
  assert(opened, '開いたら床になっている');
  assert(reachable(state.floor, arenaSpawn(state.floor, 'A'), arenaSpawn(state.floor, 'B')),
    '開いたら相手の陣地へ行ける');
}

// --- 69. 協力の盤に扉は無い（変化ゼロ） ---
{
  const coop = createInitialGame('ruin', 'coop');
  assert(coop.gate === undefined, '協力の盤に扉は無い');
  assert(coop.draft === undefined, '協力にドラフトは無い');

  addPlayer(coop, 'p1');
  startGame(coop);
  assert(coop.phase === 'playing', '協力はロビーから直接盤に入る（draft を挟まない）');
}

// --- 70. ドラフト（段階D D8） ---
{
  /*
   * **巡数が偶数**であることが、この仕掛けの土台。
   * 奇数だと先に選べる回数が 2:1 になり、A/B の割り当て自体が運になる
   * （03_改善構成.md 段階D の判断(3)「ここは譲れない」）。
   */
  assert(DRAFT_ROUNDS % 2 === 0, 'ドラフトの巡数は偶数');

  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  beginDraft(state);

  assert(state.phase === 'draft', 'ロビーの次は支度');
  assert(state.draft?.offer.length === DRAFT_OFFER, `候補が${DRAFT_OFFER}つ出る`);
  assert(state.draft?.picking === 'A', '1巡目は A が先');

  // 番でないチームは取れない
  const first = state.draft?.offer[0] as ItemId;
  assert(!draftPick(state, 'B', first), '番でないチームは取れない');
  // 出ていないものも取れない
  const notOffered = (Object.keys(ITEMS) as ItemId[]).find(
    (id) => !state.draft?.offer.includes(id),
  );
  assert(notOffered !== undefined && !draftPick(state, 'A', notOffered),
    '出ていないものは取れない');

  assert(draftPick(state, 'A', first), 'A が取れる');
  assert(state.draft?.picking === 'B', '取ったら相手の番');

  const second = state.draft?.offer[0] as ItemId;
  assert(draftPick(state, 'B', second), 'B が取れる');

  // 2人が取ったので巡が進み、残り1つは流れる
  assert(state.draft?.round === 1, '2人取ったら次の巡');
  assert(state.draft?.offer.length === DRAFT_OFFER, '次の候補が出る');
  assert(!state.draft?.offer.includes(first) && !state.draft?.offer.includes(second),
    '取られたものは出てこない');

  /*
   * **2巡目は B が先。** これで先に選んだ回数が 1 対 1 になる。
   * ここが崩れると、A に入るか B に入るかだけで有利不利が決まる。
   */
  assert(state.draft?.picking === 'B', '2巡目は B が先');

  const third = state.draft?.offer[0] as ItemId;
  draftPick(state, 'B', third);
  const fourth = state.draft?.offer[0] as ItemId;
  draftPick(state, 'A', fourth);

  // 巡が尽きたら盤に入る
  assert(state.phase === 'playing', '巡が尽きたら試合が始まる');
  assert(state.draft === undefined, '始まったら候補は消える');

  // 取ったものが袋に入っている
  const a = state.actors.find((x) => x.team === 'A' && x.kind === 'player');
  const mine = state.items.filter((i) => i.ownerId === a?.id).map((i) => i.itemId);
  assert(mine.includes(first), '1巡目に取ったものが袋にある');
  assert(mine.includes(fourth), '2巡目に取ったものが袋にある');

  // 左右で取った数が同じ
  const countOf = (t: 'A' | 'B') => {
    const who = state.actors.find((x) => x.team === t && x.kind === 'player');
    return state.items.filter((i) => i.ownerId === who?.id).length;
  };
  assert(countOf('A') === countOf('B'), '持ち物の数が左右で同じ');
}

// --- 71. AI の支度は乱数で決まらない ---
{
  const run = (): string[] => {
    const state = createInitialGame('ruin', 'versus');
    addPlayer(state, 'p1');
    fillWithBots(state);
    beginDraft(state);
    // 候補を固定して、選び方だけを見る
    if (state.draft) {
      state.draft.offer = ['potion', 'sword', 'shield'];
      state.draft.picking = 'B'; // B は AI
    }
    autoDraft(state);
    return [...(state.draft?.taken.B ?? [])];
  };
  const a = run();
  const b = run();
  assert(a.length === 1 && a[0] === 'sword', 'AI は決めた順で選ぶ（剣が最優先）');
  assert(a.join() === b.join(), '同じ候補なら AI は必ず同じものを選ぶ');
}

// --- 72. 時間切れの判定（段階D D9） ---
{
  /*
   * 生存数 → 残HP → 与ダメージ → 引き分け の順。
   * **盤の上で起きたことの重さの順**になっている。
   */
  const setUp = () => {
    const state = createInitialGame('ruin', 'versus');
    addPlayer(state, 'p1');
    addPlayer(state, 'p2');
    startGame(state);
    // 時間切れの1つ手前まで進める
    state.turn = MATCH_TURNS - 1;
    // 松明で勝手に死なないように満たしておく
    for (const a of state.actors) a.fuel = 999;
    return state;
  };

  // ① 残HP で決まる
  {
    const state = setUp();
    const a = state.actors.find((x) => x.team === 'A' && x.kind === 'player');
    const b = state.actors.find((x) => x.team === 'B' && x.kind === 'player');
    if (a) a.hp = 20;
    if (b) b.hp = 5;
    resolveTurn(state, new Map());
    assert(state.winner === 'A', '残HP が多いほうが勝つ');
  }

  // ② 残HP が並んだら与ダメージ
  {
    const state = setUp();
    for (const x of state.actors) if (x.kind === 'player') x.hp = 10;
    state.dealt = { A: 3, B: 9 };
    resolveTurn(state, new Map());
    assert(state.winner === 'B', '並んだら与えた傷が多いほうが勝つ');
  }

  // ③ 全部並んだら引き分け
  {
    const state = setUp();
    for (const x of state.actors) if (x.kind === 'player') x.hp = 10;
    state.dealt = { A: 0, B: 0 };
    resolveTurn(state, new Map());
    assert(state.winner === undefined, '全部並んだら勝者を立てない');
    assert(state.phase !== 'playing', '引き分けでも試合は終わる');
  }

  // ④ 時間内なら終わらない
  {
    const state = setUp();
    state.turn = 0;
    resolveTurn(state, new Map());
    assert(state.phase === 'playing', '時間内は終わらない');
  }
}

// --- 73. モンスターを殴っても与ダメージには数えない ---
{
  /*
   * 数えると、相手に近づかずコウモリを殴り続けた側が時間切れで勝ててしまう。
   * 対戦の答えは「相手に何をしたか」であって「何ターン働いたか」ではない。
   */
  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  startGame(state);

  const a = state.actors.find((x) => x.team === 'A' && x.kind === 'player');
  const mon = state.actors.find((x) => x.kind === 'monster');
  const foe = state.actors.find((x) => x.team === 'B' && x.kind === 'player');

  if (a && mon) damage(state, mon, 5, a);
  assert(state.dealt.A === 0, 'モンスターに与えた傷は数えない');

  if (a && foe) damage(state, foe, 5, a);
  assert(state.dealt.A === 5, '相手チームに与えた傷は数える');
}

// --- 74. 協力モードでは与ダメージを数えない（変化ゼロ） ---
{
  const state = createInitialGame('ruin', 'coop');
  addPlayer(state, 'p1');
  startGame(state);
  const me = state.actors.find((x) => x.kind === 'player');
  const mon = state.actors.find((x) => x.kind === 'monster');
  if (me && mon) damage(state, mon, 5, me);
  assert(state.dealt.A === 0 && state.dealt.B === 0, '協力では数えない');
}

// --- 75. 試合は必ず終わる ---
{
  /*
   * **決着しない盤を作らない。**
   *
   * D6 のときに「通路にモンスターが1体座っているだけで道が永久に閉じる」で
   * 8回に3回終わらない盤が出た（duel.ts の firstStep に経緯）。
   * 扉（D7）で前半を仕切り、上限ターン（D9）を置いたので、
   * **どんな盤でも必ず終わる**はず。それをここで押さえる。
   *
   * AI どうしで回すので人の判断は入らない。盤はそのつど違う。
   */
  let ended = 0;
  let byTime = 0;
  const RUNS = 12;

  for (let n = 0; n < RUNS; n++) {
    const state = createInitialGame('ruin', 'versus');
    addPlayer(state, `h${n}`);
    fillWithBots(state);
    beginDraft(state);

    // 人間の席も AI に選ばせる。両チームを AI にして回す
    for (const a of state.actors) if (a.kind === 'player') a.bot = true;
    autoDraft(state);
    assert(state.phase === 'playing', `${n + 1}回目: 支度が終わって始まる`);

    // 上限 + 少しだけ余分に回す。終わらなければそれが不具合
    for (let t = 0; t < MATCH_TURNS + 5 && state.phase === 'playing'; t++) {
      resolveTurn(state, new Map());
    }
    if (state.phase !== 'playing') {
      ended++;
      if (state.turn >= MATCH_TURNS) byTime++;
    }
  }

  assert(ended === RUNS, `${RUNS}回とも決着した（${ended}/${RUNS}）`);

  /*
   * **時間切れは逃げ道であって、決着の主な手段ではない。**
   *
   * 最初 MATCH_TURNS を 60 にしていたとき、ここが 11/12 になった。
   * つまりほとんどの試合を戦っている最中に打ち切っていた。
   * 測ったら殴り合いだけで決着するのは 48〜87 ターンだったので
   * 120 に上げてある（types.ts の MATCH_TURNS に経緯）。
   *
   * この行が落ちたら、まず「上限が短すぎないか」を疑うこと。
   * 盤の広さや松明を触ったときに、ここが先に教えてくれる。
   */
  assert(
    byTime <= RUNS / 3,
    `ほとんどは倒して決着する（時間切れ ${byTime}/${RUNS}）`,
  );
}

// --- 76. ドラフトの持ち時間 ---
{
  /*
   * **選ばれないまま止まらないこと**がこの仕掛けの目的。
   * 時間を計るのは部屋（GameRoom）の仕事なので、ここで確かめるのは
   * 「切れたときに何が起きるか」＝ autoPickFor のほう。
   */
  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  beginDraft(state);

  assert(state.draft?.deadlineAt === null, '締め切りは部屋が掛ける（初めは null）');

  const offer = [...(state.draft?.offer ?? [])];
  const was = state.draft?.picking;

  // 時間切れ。かわりに取る
  assert(autoPickFor(state), '時間切れでも1つ取る');
  assert(
    was !== undefined && state.draft?.taken[was].length === 1,
    '**飛ばさない。** 取らずに進めると片方だけ持ち物が少なくなる',
  );
  assert(state.draft?.picking !== was, '取ったら番が移る');

  /*
   * **AI の手と同じ順で選ぶ。**
   * 放っておいたときの結果が AI の手と違うと、
   * 「待ったほうが得／損」が生まれる。
   */
  const wanted = ['sword', 'shield', 'potion', 'torch', 'bomb', 'scroll'].find((id) =>
    offer.includes(id as ItemId),
  );
  assert(
    was !== undefined && state.draft?.taken[was][0] === wanted,
    `決まった順で取る（${wanted}）`,
  );

  // 候補が無ければ何もしない（落ちない）
  const empty = createInitialGame('ruin', 'versus');
  addPlayer(empty, 'q1');
  addPlayer(empty, 'q2');
  beginDraft(empty);
  if (empty.draft) empty.draft.offer = [];
  assert(!autoPickFor(empty), '候補が無ければ取らない');

  // 支度の最中でなければ何もしない
  const playing = createInitialGame('ruin', 'versus');
  addPlayer(playing, 'r1');
  addPlayer(playing, 'r2');
  startGame(playing);
  assert(!autoPickFor(playing), '試合中は取れない');
}

// --- 77. 持ち時間が切れ続けても支度は終わる ---
{
  /*
   * 両方が放置した場合。**必ず試合が始まる**こと。
   * ここが止まると、部屋が永久にロビーでも盤でもない状態で残る。
   */
  const state = createInitialGame('ruin', 'versus');
  addPlayer(state, 'p1');
  addPlayer(state, 'p2');
  beginDraft(state);

  for (let i = 0; i < DRAFT_ROUNDS * 2 + 2 && state.phase === 'draft'; i++) {
    autoPickFor(state);
  }
  assert(state.phase === 'playing', '両方が放置しても試合は始まる');

  const countOf = (t: 'A' | 'B') => {
    const who = state.actors.find((x) => x.team === t && x.kind === 'player');
    return state.items.filter((i) => i.ownerId === who?.id).length;
  };
  assert(countOf('A') === countOf('B'), '放置しても持ち物の数は左右で同じ');
}

console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
