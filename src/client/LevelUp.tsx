import { perkOf, type PerkId } from '../shared/perks';
import type { Actor } from '../shared/types';

type Props = {
  me: Actor;
  onTake: (perkId: PerkId) => void;
  onLater: () => void;
};

/**
 * レベルアップで出る3枚のカード。
 *
 * 選ぶのは**ターンの行動ではない**（GameRoom.ts の 'perk' メッセージ）。
 * 行動にすると、カードを選ぶために1手使うことになり、
 * しかも同期ターン制なので全員がその人の選択を待つことになる。
 *
 * そのため、この画面が出ている間も盤面は進みうる。
 * 「あとで」で閉じられるようにしてあるのはそのため。
 * 敵に囲まれた状態でレベルが上がったとき、逃げるより先に
 * カードを選ばされると理不尽になる。
 */
export function LevelUp({ me, onTake, onLater }: Props) {
  return (
    <div className="map-overlay">
      <div className="levelup">
        <div className="map-head">
          <b>レベル {me.level} になった</b>
          {me.pendingLevels > 1 && (
            <span className="map-progress">あと {me.pendingLevels - 1} 回</span>
          )}
          <button onClick={onLater}>あとで</button>
        </div>

        <p className="hint">1枚だけ選ぶ。残りは消える。</p>

        <div className="cards">
          {me.offers.map((id) => {
            const perk = perkOf(id);
            const have = me.perks.filter((p) => p === id).length;
            return (
              <button key={id} className="card" onClick={() => onTake(id)}>
                <span className="card-glyph">{perk.glyph}</span>
                <span className="card-name">
                  {perk.name}
                  {have > 0 && <span className="card-have">所持 {have}</span>}
                </span>
                <span className="card-desc">{perk.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
