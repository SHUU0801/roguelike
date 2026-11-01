import { speciesOf } from '../shared/monsters';
import { BLESS_BONUS } from '../shared/skills';
import {
  effectiveAtk,
  effectiveDef,
  hasEffect,
  type Actor,
  type GameState,
} from '../shared/types';
import { pushLog } from './game';
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
 * v0 では pvp: false しか呼ばれない。だが引数の口を開けておくだけで、
 * v1.5 の「対戦から乱数を消す」作業がこの関数1つで終わる。
 * ここを作らずに乱数を各所にばら撒くと、後で全部探し回ることになる。
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

  const name = speciesOf(defender.speciesId).name;
  // 攻撃1回で2行出すと、表示枠から自分の与ダメージが押し出されて消える。
  // 1行にまとめる
  pushLog(
    state,
    attacker
      ? `${speciesOf(attacker.speciesId).name} → ${name} ${dealt}ダメージ`
      : `${name}に${dealt}ダメージ`,
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
}

/** 殴る */
export function attack(
  state: GameState,
  attacker: Actor,
  defender: Actor,
  opts: { pvp: boolean } = { pvp: false },
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
  const base = calcDamage(attacker, defender, { pvp: false }, state.turn, state);
  pushLog(state, '背後から不意を突いた！');
  damage(state, defender, base * SNEAK_MULTIPLIER, attacker);
}
