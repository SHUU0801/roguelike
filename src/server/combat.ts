import { speciesOf } from '../shared/monsters';
import { BLESS_BONUS } from '../shared/skills';
import {
  effectiveAtk,
  effectiveDef,
  hasEffect,
  isHostile,
  teamOf,
  type Actor,
  type GameState,
} from '../shared/types';
import { logScopeNow, pushLog, setLogScope } from './game';
import { applyMend, awardExp, expFor } from './levels';
import { randInt } from './random';

/**
 * ダメージ計算。
 *
 * opts.pvp が v1.5（2vs2 対戦）への仕込み。
 * 対戦では乱数を一切入れない ——「運で負けた」を調整ではなく構造で消すため。
 * ターン制対戦で最も嫌われるのが「当たるはずの攻撃が外れた」なので、
 * 対戦側は確定計算にして将棋の側に寄せる。
 *
 * v0 では協力モードしか無かったので、常に乱数ありで呼ばれていた。
 * 引数の口を開けておいたおかげで、**v1.5 の「対戦から乱数を消す」は
 * attack の既定値を pvpOf(state) に変える1行で終わった**（下）。
 * ここを作らずに乱数を各所にばら撒いていたら、全部探し回ることになっていた。
 */
export function calcDamage(
  attacker: Actor,
  defender: Actor,
  opts: { pvp: boolean },
  turn?: number,
  state?: GameState,
): number {
  // 乱数を加算ではなく振れ幅にする。
  // 旧: max(1, atk-def) + randInt(0,2) だと、加算項が def で減らないため
  // 防御力に天井ができていた（盾2枚目の効果が数値上ゼロ）。
  // この形なら def が最後まで効き、対戦の確定値が協力の中央値と一致する。
  // 挑発やまもりのうたの上乗せ。turn が無い呼び方（単体テスト）では素の防御だけ見る
  const bonus = turn === undefined || !hasEffect(defender, 'guard', turn) ? 0 : BLESS_BONUS + 1;
  // 装備は袋に入っている間だけ効く。state が無い呼び方（単体テスト）では素の値
  const atk = state ? effectiveAtk(state, attacker) : attacker.atk;
  const def = state ? effectiveDef(state, defender) : defender.def;
  const base = atk - (def + bonus);
  if (opts.pvp) return Math.max(1, base); // 対戦: 確定値
  return Math.max(1, base + randInt(-1, 1)); // 協力: 少し振れてドラマになる
}

/**
 * その盤で乱数を入れてよいか。
 *
 * **対戦では乱数を一切入れない。** 「同じ判断をしたのに結果が違う」が
 * ターン制対戦で最も嫌われるので、対戦側は確定計算にして将棋の側に寄せる
 * （03_改善構成.md 段階D）。
 *
 * 呼ぶ側が `{ pvp: false }` と書き下さないで済むように、
 * **attack の既定値をこれにしてある。** 書き下せるようにしておくと、
 * どこか1か所で false のまま残り、対戦に乱数が1本だけ生き残る。
 * 03_改善構成.md が「運で負けたら疑う順」の③に挙げているのがまさにこれ。
 */
export function pvpOf(state: GameState): { pvp: boolean } {
  return { pvp: state.mode === 'versus' };
}

/**
 * HP を削る。倒れたら alive を落とすところまで。
 * 死体の片付けと勝敗判定は resolve.ts がまとめて行う。
 */
export function damage(
  state: GameState,
  defender: Actor,
  amount: number,
  attacker?: Actor,
): void {
  // 盾の構えは「受けるダメージ」に効く。毒や松明切れにも効かせる。
  // 攻撃にだけ効かせると、同じ「減る」でも理由によって効いたり効かなかったりして
  // 画面から仕組みが読み取れなくなる
  const dealt = hasEffect(defender, 'bulwark', state.turn)
    ? Math.max(1, Math.ceil(amount / 2))
    : amount;

  defender.hp = Math.max(0, defender.hp - dealt);

  /*
   * 相手チームに与えた傷を数える（段階D D9）。
   *
   * 時間切れのとき、生存数も残HPも並んだら**攻めた側を勝たせる**ための物差し。
   *
   * **モンスターに与えた傷は数えない。** 数えると、相手に近づかず
   * コウモリを殴り続けた側が時間切れで勝ててしまう。対戦の答えは
   * 「相手に何をしたか」であって「何ターン働いたか」ではない。
   */
  if (
    state.mode === 'versus' &&
    attacker !== undefined &&
    attacker.kind === 'player' &&
    defender.kind === 'player' &&
    isHostile(attacker, defender)
  ) {
    const side = teamOf(attacker);
    if (side !== null) state.dealt[side] += dealt;
  }

  /*
   * 殴り合いの行は、**殴った側と殴られた側の両方に見せる。**
   *
   * ログは行動した人のチームに絞っている（D4）が、それをそのまま当てると
   * 殴られたほうには1行も出ず、**HP だけ減って理由が分からない**。
   * 実際に対戦を通しで遊んで最初に困ったのがこれだった。
   *
   * 陣営は2つしかないので「両方」は「全員」と同じ。
   * 誰が殴ったか分からない行（松明切れ・毒）は、殴られた側にだけ出す。
   *
   * 協力モードではプレイヤーが全員チーム A なので、どちらに倒しても
   * 届く先は変わらない。**見え方は1行も変わらない。**
   */
  const keep = logScopeNow();
  const hurt = teamOf(defender);
  if (hurt !== null && hurt !== keep) setLogScope(keep === null ? hurt : null);

  /*
   * 対戦では、プレイヤーは番号で呼ぶ。
   * 両方とも種族が「冒険者」なので、「冒険者 → 冒険者 1ダメージ」になって
   * どちらが殴ったのか読めない（これも遊んで気づいた）。
   * 協力モードは今までどおり種族の名前のまま。
   */
  const callOf = (a: Actor): string =>
    state.mode === 'versus' && a.kind === 'player'
      ? `${a.slot}番`
      : speciesOf(a.speciesId).name;

  const name = callOf(defender);
  // 攻撃1回で2行出すと、表示枠から自分の与ダメージが押し出されて消える。
  // 1行にまとめる
  pushLog(
    state,
    attacker ? `${callOf(attacker)} → ${name} ${dealt}ダメージ` : `${name}に${dealt}ダメージ`,
  );

  if (defender.hp === 0) {
    defender.alive = false;
    pushLog(state, defender.kind === 'player' ? `${name}は力尽きた…` : `${name}を倒した`);

    // 経験値と吸命。ここに置くのは、倒れる経路が1本しかないから。
    // 殴り・スキル・爆弾・松明切れのどれで倒しても必ずここを通る
    if (defender.kind === 'monster') {
      if (attacker?.kind === 'player') applyMend(state, attacker);
      awardExp(state, expFor(defender));
    }
  }

  setLogScope(keep);
}

/** 殴る */
export function attack(
  state: GameState,
  attacker: Actor,
  defender: Actor,
  /*
   * 既定が盤の種類から決まるので、呼ぶ側は何も渡さなくてよい。
   * **渡さないのが正しい呼び方。** 明示的に渡す必要があるのは、
   * 盤の種類に関係なく確定値にしたい場合だけ（いまは無い）。
   */
  opts: { pvp: boolean } = pvpOf(state),
): void {
  damage(state, defender, calcDamage(attacker, defender, opts, state.turn, state), attacker);
}

/**
 * 不意打ち。気づいていない敵を殴ったときの一撃。
 *
 * 倍率を掛けるだけでなく、**その敵のそのターンの行動を奪う**のが本体
 * （resolve.ts が stun を付ける）。これが無いと、背後を取っても
 * 結局そのターンに殴り返されて、忍び寄る意味が半分になる。
 */
export const SNEAK_MULTIPLIER = 2;

export function sneakAttack(state: GameState, attacker: Actor, defender: Actor): void {
  const base = calcDamage(attacker, defender, pvpOf(state), state.turn, state);
  pushLog(state, '背後から不意を突いた！');
  damage(state, defender, base * SNEAK_MULTIPLIER, attacker);
}
