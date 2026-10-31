import { speciesOf } from '../shared/monsters';
import type { Actor, GameState } from '../shared/types';
import { pushLog } from './game';
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
): number {
  // 乱数を加算ではなく振れ幅にする。
  // 旧: max(1, atk-def) + randInt(0,2) だと、加算項が def で減らないため
  // 防御力に天井ができていた（盾2枚目の効果が数値上ゼロ）。
  // この形なら def が最後まで効き、対戦の確定値が協力の中央値と一致する。
  const base = attacker.atk - defender.def;
  if (opts.pvp) return Math.max(1, base); // 対戦: 確定値
  return Math.max(1, base + randInt(-1, 1)); // 協力: 少し振れてドラマになる
}

/**
 * HP を削る。倒れたら alive を落とすところまで。
 * 死体の片付けと勝敗判定は resolve.ts がまとめて行う。
 */
export function damage(state: GameState, defender: Actor, amount: number): void {
  defender.hp = Math.max(0, defender.hp - amount);

  const name = speciesOf(defender.speciesId).name;
  pushLog(state, `${name}に${amount}ダメージ`);

  if (defender.hp === 0) {
    defender.alive = false;
    pushLog(state, defender.kind === 'player' ? `${name}は力尽きた…` : `${name}を倒した`);
  }
}

/** 殴る */
export function attack(
  state: GameState,
  attacker: Actor,
  defender: Actor,
  opts: { pvp: boolean } = { pvp: false },
): void {
  pushLog(state, `${speciesOf(attacker.speciesId).name}の攻撃`);
  damage(state, defender, calcDamage(attacker, defender, opts));
}
