import { itemDefOf } from '../shared/items';
import { speciesOf } from '../shared/monsters';
import {
  actorAt,
  dirTo,
  itemAt,
  seenAt,
  tileAt,
  visibleAt,
  type Dir,
  type GameState,
} from '../shared/types';

/**
 * 見える範囲（マス数）。
 *
 * 9×13 で始めたが、375×667（iPhone SE / iPhone 8）で実測したら
 * 画面を 103px はみ出していた。ページがスクロールしてしまい、
 * 盤面をタップしようとした指がスクロールを起こして移動が空振りする。
 * 11 行なら収まる。設計書 §7 の「実機で確認してから確定する」の確定値。
 */
const VIEW_W = 9;
const VIEW_H = 11;

type Props = {
  state: GameState;
  myId: string;
  onMove: (dir: Dir) => void;
};

/**
 * ダンジョンのマス目。
 *
 * Canvas を使わず CSS Grid で描く（設計書 §7）。
 * 要素として並べておけば、画面を見ながら「このマスがおかしい」と指差して直せる。
 *
 * マスは3段階で描き分ける:
 *   今見えている       … 地形 + Actor + アイテム
 *   見たことがある     … 地形だけ（暗く）
 *   見たことがない     … 真っ黒
 */
export function FloorView({ state, myId, onMove }: Props) {
  const { floor } = state;
  const me = state.actors.find((a) => a.id === myId);

  // 自キャラを常に中央に置く。端では盤外が映るが、盤外は真っ黒になるので問題ない
  const originX = (me ? me.pos.x : 0) - Math.floor(VIEW_W / 2);
  const originY = (me ? me.pos.y : 0) - Math.floor(VIEW_H / 2);

  const cells = [];
  for (let vy = 0; vy < VIEW_H; vy++) {
    for (let vx = 0; vx < VIEW_W; vx++) {
      const x = originX + vx;
      const y = originY + vy;

      const visible = visibleAt(floor, x, y);
      const remembered = !visible && seenAt(floor, x, y);
      const tile = tileAt(floor, x, y);

      const dir = me ? dirTo(me.pos, { x, y }) : null;
      const movable = dir !== null && tile !== 'wall' && (visible || remembered);

      // 自分と仲間が同じ絵文字なので、枠の色で見分ける
      const occupant = visible ? actorAt(state, x, y) : undefined;
      const mark =
        occupant?.kind === 'player' ? (occupant.id === myId ? 'me' : 'ally') : '';

      cells.push(
        <div
          key={`${x},${y}`}
          className={[
            'cell',
            visible || remembered ? tile : 'unseen',
            remembered ? 'dim' : '',
            movable ? 'movable' : '',
            mark,
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={movable && dir ? () => onMove(dir) : undefined}
        >
          {glyphAt(state, x, y, visible, remembered)}
        </div>,
      );
    }
  }

  return (
    <div
      className="floor"
      style={{ gridTemplateColumns: `repeat(${VIEW_W}, 1fr)` }}
    >
      {cells}
    </div>
  );
}

/**
 * そのマスに出す絵文字。Actor > アイテム > 地形 の優先順。
 * 「見たことがあるだけ」のマスには、動くもの（Actor・アイテム）を出さない。
 * 記憶に残るのは地形だけ、という扱い。
 */
function glyphAt(
  state: GameState,
  x: number,
  y: number,
  visible: boolean,
  remembered: boolean,
): string {
  if (visible) {
    const actor = actorAt(state, x, y);
    if (actor) return speciesOf(actor.speciesId).glyph;

    const item = itemAt(state, x, y);
    if (item) return itemDefOf(item.itemId).glyph;
  }

  if (!visible && !remembered) return '';

  return tileAt(state.floor, x, y) === 'stairs' ? '🔽' : '';
}
