import { BASE_SKILL } from '../shared/skills';
import {
  DIR_DELTA,
  actorAt,
  isHostile,
  tileAt,
  type Actor,
  type Dir,
  type GameState,
  type Intent,
  type Pos,
} from '../shared/types';
import { arenaSpawn } from './dungeon';
import { skillReady } from './skills';
import { visionOf } from './vision';

/**
 * AI 相手の思考（03_改善構成.md 段階D D6）。
 *
 * ## これは何のためにあるか
 *
 * **作者1人で対戦を通しで確認できるようにするため。**
 * 人間を2人そろえないと一度も遊べない状態では、対戦の作りかけを
 * 確かめる手段が無く、開発が止まる（仕様書の判断(2)）。
 *
 * ## モンスターの ai.ts と分けてある理由
 *
 * この AI が返すのは **`Intent`** で、モンスターのように盤を直接動かさない。
 * つまり人間が送ってくるものとまったく同じものを返す。
 * 移動・体当たり攻撃・わざ・持ち物・自動で拾う——すべて人間と同じ道を通るので、
 * **戦闘やアイテムの規則をここに書き写さずに済む。**
 * 書き写すと、片方だけ直して「AI だけ強い／弱い」が生まれる。
 *
 * ## 乱数を使わない
 *
 * この関数の中に `Math.random()` は1つも無い。
 * 対戦で避けたいのは「同じ判断をしたのに結果が違う」なので、
 * 相手の手が抽選で決まってはいけない。
 * 同じ盤・同じ位置なら必ず同じ手を返す。
 *
 * ## 自分に見えているものだけで決める
 *
 * 相手の位置はチームの視界（vision.ts）を通してしか見ない。
 * state を直接なめれば壁の向こうのプレイヤーも分かるが、それをすると
 * 「相手の位置を隠す」仕掛けが効いているかどうかを AI で確かめられなくなる。
 * **AI が迷子になるなら、それは隠せている証拠。**
 */

/**
 * 見つけていないときに向かう先。
 *
 * 開門前は**扉の前**。相手の陣地は壁で仕切られていて行けないので、
 * そこを目指すと経路が見つからず、その場で止まってしまう（段階D D7）。
 * 開いてからは相手の出発点へ。歩くだけで必ず相手に行き当たる。
 */
function goal(state: GameState, bot: Actor): Pos {
  const gate = state.gate;
  if (gate && !gate.open) {
    // 自陣側の扉のマスの手前。鏡なのでどちらのチームからも同じ距離
    const half = state.floor.width / 2;
    const mine = gate.cells.find((c) => (bot.team === 'A' ? c.x < half : c.x >= half));
    if (mine) return mine;
  }
  // 自分がチーム A なら B の出発点へ、B なら A の出発点へ
  return arenaSpawn(state.floor, bot.team === 'A' ? 'B' : 'A', 0);
}

/** 体力がこの割合を下回ったら薬草を飲む */
const DRINK_AT = 0.45;

export function botIntent(state: GameState, bot: Actor): Intent {
  if (!bot.alive) return { type: 'wait' };

  const foes = visibleFoes(state, bot);
  const adjacent = foes.find((f) => manhattan(f.pos, bot.pos) === 1);

  // 1. 傷が深ければ先に飲む。隣に敵がいても飲む。
  //    「殴り合いながら飲む」ができるのは薬草が1ターンで効くからで、
  //    人間も同じことをする
  if (bot.hp < bot.maxHp * DRINK_AT) {
    // 薬草だけを探す。効果は effects.ts の itemId ごとの分岐なので、
    // 「回復するもの」を表から引く口が無い。増えたらここに足す
    const potion = state.items.find(
      (i) => i.ownerId === bot.id && i.at !== null && i.itemId === 'potion',
    );
    if (potion) return { type: 'useItem', instanceId: potion.id };
  }

  // 2. 隣に敵。わざが使えるならわざ、だめなら体当たり
  if (adjacent) {
    const skill = readySkill(state, bot);
    if (skill) return { type: 'skill', skillId: skill };
    const dir = dirToward(bot.pos, adjacent.pos);
    if (dir) return { type: 'move', dir };
  }

  // 3. 僧侶の回復は隣に敵がいなくても使う（唯一の例外）。
  //    待ち時間が長いので、殴り合いの前に戻しておくほうが強い
  if (bot.job === 'cleric' && bot.hp < bot.maxHp - 2) {
    const heal = BASE_SKILL.cleric;
    if (skillReady(state, bot, heal) && bot.skills.includes(heal)) {
      return { type: 'skill', skillId: heal };
    }
  }

  // 4. 見えている敵へ向かう。一番近いものから
  const target = nearest(bot, foes);
  if (target) {
    const dir = firstStep(state, bot, target.pos);
    if (dir) return { type: 'move', dir };
  }

  // 5. 見えている床のアイテムを拾いに行く。近いものだけ。
  //    鏡像なので同じものが相手側にもあり、取り合いにはならない
  const loot = nearestLoot(state, bot);
  if (loot) {
    const dir = firstStep(state, bot, loot);
    if (dir) return { type: 'move', dir };
  }

  // 6. まだ見つけていない。相手の陣地へ歩く。
  //    **ここで乱数の探索をしない。** うろうろさせると、
  //    勝敗が「AI がどちらへ曲がったか」で決まり始める
  const dir = firstStep(state, bot, goal(state, bot));
  if (dir) return { type: 'move', dir };

  return { type: 'wait' };
}

/** 隣に敵がいるときに使える基本わざ。回復は別に扱うので外す */
function readySkill(state: GameState, bot: Actor): string | null {
  for (const id of bot.skills) {
    if (id === 'heal') continue; // 隣に敵がいる場面では回復を選ばない
    if (skillReady(state, bot, id)) return id;
  }
  return null;
}

/**
 * 自分のチームに見えている敵。
 * 視界を通すので、壁の向こうの相手は「いない」ことになる。
 */
function visibleFoes(state: GameState, bot: Actor): Actor[] {
  const mine = visionOf(state.floor, bot.team === 'M' ? 'A' : bot.team);
  const at = (p: Pos) => mine.visible[p.y * state.floor.width + p.x] === true;
  return state.actors.filter((a) => a.alive && isHostile(bot, a) && at(a.pos));
}

/** 見えている床のアイテムのうち、歩いて近いもの */
const LOOT_RANGE = 6;

function nearestLoot(state: GameState, bot: Actor): Pos | null {
  const mine = visionOf(state.floor, bot.team === 'M' ? 'A' : bot.team);
  let best: Pos | null = null;
  let bestDist = LOOT_RANGE + 1;
  for (const item of state.items) {
    if (item.pos === null) continue;
    if (mine.visible[item.pos.y * state.floor.width + item.pos.x] !== true) continue;
    const d = manhattan(item.pos, bot.pos);
    // 同じ距離なら座標の小さいほうを選ぶ。並びで手が変わらないようにする
    if (d < bestDist || (d === bestDist && best !== null && lessThan(item.pos, best))) {
      bestDist = d;
      best = item.pos;
    }
  }
  return best;
}

function lessThan(a: Pos, b: Pos): boolean {
  return a.y < b.y || (a.y === b.y && a.x < b.x);
}

function nearest(from: Actor, list: Actor[]): Actor | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((closest, a) => {
    const da = manhattan(from.pos, a.pos);
    const dc = manhattan(from.pos, closest.pos);
    if (da < dc) return a;
    if (da === dc && lessThan(a.pos, closest.pos)) return a;
    return closest;
  });
}

/** 隣にいる相手へ踏み込む方向。体当たりが攻撃になる */
function dirToward(from: Pos, to: Pos): Dir | null {
  for (const dir of SCAN) {
    const d = DIR_DELTA[dir];
    if (from.x + d.x === to.x && from.y + d.y === to.y) return dir;
  }
  return null;
}

/** 調べる順番。**固定**。ここを乱数にすると AI の手が抽選になる */
const SCAN: Dir[] = ['n', 'e', 's', 'w'];

/**
 * to までの最短経路の1歩目。幅優先探索。
 *
 * 壁と他の Actor は通れない（目的地にいる相手だけは例外で、
 * そこへ踏み込むのが攻撃になる）。
 * 同じ距離の道が複数あるときは SCAN の順で先に見つかったほうを使うので、
 * **同じ盤なら必ず同じ道**を選ぶ。
 *
 * A* にしないのは ai.ts と同じ理由（壁で引っかかるのは戦術材料）。
 * ただし**こちらは引っかかったままだと試合が終わらない**ので、
 * 貪欲法ではなく探索にしてある。盤が 18×15 なので費用は問題にならない。
 */
function firstStep(state: GameState, bot: Actor, to: Pos): Dir | null {
  const { floor } = state;
  if (bot.pos.x === to.x && bot.pos.y === to.y) return null;

  const index = (p: Pos) => p.y * floor.width + p.x;
  // そのマスへ最初に踏み出した方向を覚える。1歩目だけが要るので経路は持たない
  const firstDir = new Map<number, Dir>();
  const seen = new Set<number>([index(bot.pos)]);
  let frontier: Pos[] = [bot.pos];

  while (frontier.length > 0) {
    const next: Pos[] = [];
    for (const at of frontier) {
      for (const dir of SCAN) {
        const d = DIR_DELTA[dir];
        const p = { x: at.x + d.x, y: at.y + d.y };
        if (p.x < 0 || p.y < 0 || p.x >= floor.width || p.y >= floor.height) continue;
        if (seen.has(index(p))) continue;
        if (tileAt(floor, p.x, p.y) === 'wall') continue;

        const came = firstDir.get(index(at)) ?? dir;
        if (p.x === to.x && p.y === to.y) return came;

        /*
         * 味方が立っているマスは通れない。
         *
         * **敵（モンスターも相手チームも）は通れるものとして数える。**
         * 対戦ではモンスターがうろうろしない（ai.ts の patrol）ので、
         * 通路に1体座っているだけで道が永久に閉じる。
         * 実際それで試合が終わらなくなった（決着しない盤が8回に3回）。
         * 敵を「通れる」と見れば、その1歩目は体当たり＝攻撃になり、
         * 倒してから進む。道をふさぐものは倒す、が正しい答え。
         */
        const who = actorAt(state, p.x, p.y);
        if (who && !isHostile(bot, who)) continue;

        seen.add(index(p));
        firstDir.set(index(p), came);
        next.push(p);
      }
    }
    frontier = next;
  }
  return null;
}

function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
