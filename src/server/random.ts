/**
 * 乱数はサーバーだけが振る（設計書 §11）。
 * クライアントで Math.random() を呼ばないこと。
 *
 * v1.5 の対戦では「両チームに同じ内容で起きるか」が判定基準になる。
 * そのとき乱数の入口をここ1か所に絞っておくと、シード固定に差し替えやすい。
 */

/** min 以上 max 以下の整数 */
export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 配列から1つ選ぶ。空配列なら undefined */
export function pick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randInt(0, items.length - 1)];
}

/** 配列をその場でシャッフルする */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
