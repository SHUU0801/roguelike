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

// --- 4. 剣で攻撃力が上がる ---
{
  const { state, me } = fresh();
  const before = me.atk;
  state.items.push({ id: 'it-sword', itemId: 'sword', pos: null, ownerId: 'p1' });
  turn(state, { type: 'useItem', instanceId: 'it-sword' });
  assert(me.atk === before + 3, `剣で攻撃力が上がる (${before} → ${me.atk})`);
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
    speciesId: 'goblin',
    pos: { x: me.pos.x + 1, y: me.pos.y },
    hp: 99,
    maxHp: 99,
    atk: 99,
    def: 0,
    alive: true,
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

console.log(failed === 0 ? '\nすべて通過' : `\n${failed} 件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
