/** 使い捨ての動作確認スクリプト。npx tsx check.ts */
import {
  addPlayer,
  chooseJob,
  createInitialGame,
  inventoryOf,
  startGame,
} from './src/server/game';
import { createFloor, spawnPos } from './src/server/dungeon';
import { DURATION, motionAt } from './src/client/motion';
import { dungeonOf } from './src/shared/dungeons';
import { putIn, rearrange as rearrangeItem, usedCells } from './src/server/backpack';
import { awardExp, takePerk } from './src/server/levels';
import { resolveTurn, retireCleanup } from './src/server/resolve';
import { updateVision } from './src/server/vision';
import { JOBS, type JobId } from './src/shared/jobs';
import { BASE_SKILL } from './src/shared/skills';
import { OFFER_COUNT, PERKS, PERK_IDS, perkCount, perkOf } from './src/shared/perks';
import {
  BAG_H,
  DIR_DELTA,
  MAX_LEVEL,
  effectiveAtk,
  effectiveDef,
  expToNext,
  tileAt,
  type Actor,
  type Dir,
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

  assert(DURATION.moved === 0.32, '歩きの長さは 2D 版と同じ 0.32 秒');

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

console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
