/** 使い捨ての動作確認スクリプト。npx tsx check.ts */
import {
  addPlayer,
  chooseJob,
  createInitialGame,
  inventoryOf,
  startGame,
} from './src/server/game';
import { awardExp, takePerk } from './src/server/levels';
import { resolveTurn } from './src/server/resolve';
import { updateVision } from './src/server/vision';
import { JOBS, type JobId } from './src/shared/jobs';
import { OFFER_COUNT, PERKS, PERK_IDS, perkCount } from './src/shared/perks';
import { expToNext, type Actor, type GameState, type Intent } from './src/shared/types';

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
    job: null,
    level: 1,
    exp: 0,
    skillReadyAt: 0,
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

  state.items.push({ id: 'it-potion', itemId: 'potion', pos: { ...me.pos }, ownerId: null });
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

// --- 4. 剣と盾に正負が付いている ---
{
  const { state, me } = fresh();
  const atk0 = me.atk;
  const def0 = me.def;
  state.items.push({ id: 'it-sword', itemId: 'sword', pos: null, ownerId: 'p1' });
  turn(state, { type: 'useItem', instanceId: 'it-sword' });
  assert(
    me.atk === atk0 + 4 && me.def === def0 - 1,
    `剣は攻撃+4 防御-1 (攻 ${atk0}→${me.atk} / 防 ${def0}→${me.def})`,
  );
}

// --- 4b. 盾は守りと引き換えに攻撃が下がる ---
{
  const { state, me } = fresh();
  const atk0 = me.atk;
  const def0 = me.def;
  const max0 = me.maxHp;
  state.items.push({ id: 'it-shield', itemId: 'shield', pos: null, ownerId: 'p1' });
  turn(state, { type: 'useItem', instanceId: 'it-shield' });
  assert(
    me.def === def0 + 3 && me.atk === atk0 - 1 && me.maxHp === max0 + 4,
    `盾は防御+3 最大HP+4 攻撃-1 (防 ${def0}→${me.def} / 攻 ${atk0}→${me.atk})`,
  );
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

  state.items.push({ id: 'it-bomb', itemId: 'bomb', pos: null, ownerId: 'p1' });
  turn(state, { type: 'useItem', instanceId: 'it-bomb' });
  assert(mate.hp === mateHp, `爆弾は仲間に当たらない (HP ${mateHp} → ${mate.hp})`);
}

// --- 11. 乗ったら自動で拾う ---
{
  const { state, me } = fresh();
  state.items.push({
    id: 'it-auto',
    itemId: 'potion',
    pos: { x: me.pos.x + 1, y: me.pos.y },
    ownerId: null,
  });
  turn(state, { type: 'move', dir: 'e' });
  assert(
    inventoryOf(state, 'p1').some((i) => i.id === 'it-auto'),
    'アイテムの上に乗ると、同じターンで拾う',
  );
}

// --- 12. 倒れたプレイヤーの持ち物が床に落ちる ---
{
  const { state, me } = fresh();
  state.items.push({ id: 'it-drop', itemId: 'sword', pos: null, ownerId: 'p1' });
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
  state.items.push({ id: 'it-torch', itemId: 'torch', pos: null, ownerId: 'p1' });
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
  state.items.push({ id: 'it-scroll', itemId: 'scroll', pos: null, ownerId: 'p1' });
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

  state.items.push({ id: 'it-give', itemId: 'potion', pos: null, ownerId: 'p1' });
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
  state.items.push({ id: 'it-a', itemId: 'potion', pos: null, ownerId: 'p1' });
  state.items.push({ id: 'it-b', itemId: 'bomb', pos: null, ownerId: 'p1' });
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

  const victim = putMonster(state, 'xp', 'bat', { x: p1.pos.x + 1, y: p1.pos.y }, {
    hp: 1,
    maxHp: 1,
    atk: 0,
  });
  resolveTurn(
    state,
    new Map<string, Intent>([
      ['p1', { type: 'move', dir: 'e' }],
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
  turn(state, { type: 'skill' });
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
  turn(state, { type: 'skill' });
  assert(
    wall.hp === 60 - me.atk,
    `きゅうしょづきは防御99でも攻撃力ぶん通る (${60 - wall.hp} ダメージ / 攻撃力 ${me.atk})`,
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
  turn(state, { type: 'skill' });
  const afterFirst = target.hp;
  turn(state, { type: 'skill' });
  assert(target.hp === afterFirst, `連続では撃てない (${afterFirst} → ${target.hp})`);
}

// --- 34. 空振りしたスキルは待ち時間を使わない ---
{
  const { state, me } = fresh();
  setJob(me, 'warrior');
  state.actors = state.actors.filter((a) => a.kind === 'player');
  turn(state, { type: 'skill' }); // 隣に敵がいない
  assert(me.skillReadyAt <= state.turn, '敵がいないときに撃っても待ち時間にならない');
}

console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
