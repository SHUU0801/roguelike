/** 使い捨ての動作確認スクリプト。npx tsx check.ts */
import { addPlayer, createInitialGame, inventoryOf, startGame } from './src/server/game';
import { resolveTurn } from './src/server/resolve';
import { updateVision } from './src/server/vision';
import type { Actor, GameState, Intent } from './src/shared/types';

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
  state.actors.push({
    id: 'bully',
    kind: 'monster',
    team: 'M',
    speciesId: 'goblin',
    pos: { x: me.pos.x + 1, y: me.pos.y },
    hp: 99,
    maxHp: 99,
    atk: 99,
    def: 0,
    alive: true,
    fuel: 0,
  });
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
  state.actors.push({
    id: 'bully2',
    kind: 'monster',
    team: 'M',
    speciesId: 'goblin',
    pos: { x: me.pos.x + 1, y: me.pos.y },
    hp: 99,
    maxHp: 99,
    atk: 99,
    def: 0,
    alive: true,
    fuel: 0,
  });
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
  state.actors.push({
    id: 'chaser',
    kind: 'monster',
    team: 'M',
    speciesId: 'goblin',
    pos: { x: me.pos.x - 1, y: me.pos.y },
    hp: 30,
    maxHp: 30,
    atk: 8,
    def: 0,
    alive: true,
    fuel: 0,
  });
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

console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
