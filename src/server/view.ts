import type { Actor, GameState, ItemInstance, TeamId } from '../shared/types';
import { visionOf } from './vision';

/**
 * その人に配る state を作る（03_改善構成.md 段階D D2〜D4）。
 *
 * ## 隠すのは4つだけ
 *
 *   1. Actor の位置    見えていないマスの敵・相手プレイヤーを落とす
 *   2. 床のアイテム    同じく、見えていないマスのものを落とす
 *   3. ログ            logScope が自分のチームでない行を落とす
 *   4. 視界            floor.visible / floor.seen を自分のチームのものに差し替える
 *
 * **地形（floor.tiles）は隠さない。**
 * 対戦のフロアは鏡像なので、相手の陣地は自陣をそのまま裏返したもの。
 * 見えても新しい情報が1つも増えない。
 * ここに気づいていなかったら「タイル配列を部分マスクして送る」を書いていて、
 * 作業量が3倍になっていた（仕様書の判断(1)）。
 *
 * ## 協力モードは state をそのまま返す
 *
 * **1行も削らない。** チームが1つしか無いので隠す相手が存在しない。
 * 「協力モードは変化ゼロ」を**条件分岐ではなく同じオブジェクトを返すこと**で
 * 保証しているので、この先どれだけ対戦側を触っても協力モードは壊れない。
 * 段階 D2・D3 の正しさの定義がこれ（変化ゼロ）なので、check.ts でも押さえている。
 */
export function viewFor(state: GameState, team: TeamId | null): GameState {
  if (state.mode !== 'versus') return state;
  // チームの分からない見物人には、何も見えない視界で配る
  const mine = team ?? 'A';

  const vision = visionOf(state.floor, mine);
  const seesTile = (x: number, y: number): boolean =>
    vision.visible[y * state.floor.width + x] === true;

  /*
   * 自分のチームは常に見える。
   *
   * 視界だけで絞ると、同じ部屋にいない味方が消える。
   * 協力モードで仲間の位置を共有しているのと同じ理屈で、
   * **チームの中では位置を共有する**（PartyBar と全体マップがこれに依存している）。
   */
  const actors: Actor[] = state.actors.filter(
    (a) => a.team === mine || seesTile(a.pos.x, a.pos.y),
  );

  const items: ItemInstance[] = state.items.filter((i) => {
    // 床にあるもの: 見えているマスだけ
    if (i.pos !== null) return seesTile(i.pos.x, i.pos.y);
    // 誰かの持ち物: 自分のチームのぶんだけ。
    // 相手の袋の中身は、見えていても渡さない（装備で強さが読めてしまう）
    const owner = state.actors.find((a) => a.id === i.ownerId);
    return owner !== undefined && owner.team === mine;
  });

  const log: string[] = [];
  for (let i = 0; i < state.log.length; i++) {
    const scope = state.logScope[i] ?? null;
    if (scope === null || scope === mine) log.push(state.log[i]);
  }

  /*
   * 勝敗は受け取る人の側から見た値に直す。
   * phase は全員に同じ値が入る器なので、ここで分ける（types.ts の winner）。
   */
  const phase =
    state.winner === undefined ? state.phase : state.winner === mine ? 'won' : 'lost';

  return {
    ...state,
    phase,
    actors,
    items,
    log,
    // 中身は絞ったので、どの行が誰向けだったかは渡さない
    logScope: [],
    floor: {
      ...state.floor,
      visible: vision.visible,
      seen: vision.seen,
    },
  };
}
