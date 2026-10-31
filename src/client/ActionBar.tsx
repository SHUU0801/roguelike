import { itemDefOf } from '../shared/items';
import type { GameState, Intent, ItemInstance } from '../shared/types';

type Props = {
  state: GameState;
  myId: string;
  onAction: (intent: Intent) => void;
  onStairs: boolean;
  hasItemHere: boolean;
  /** ゲームが終わっていたら全部押せなくする */
  playing: boolean;
  inventoryOpen: boolean;
  onToggleInventory: () => void;
};

/**
 * 画面下のアクションボタンと、持ち物の一覧。
 * ボタンは4つまで。スマホの縦持ちで親指が届く範囲に収める。
 */
export function ActionBar({
  state,
  myId,
  onAction,
  onStairs,
  hasItemHere,
  playing,
  inventoryOpen,
  onToggleInventory,
}: Props) {
  const inventory: ItemInstance[] = state.items.filter((i) => i.ownerId === myId);

  return (
    <>
      {inventoryOpen && (
        <div className="inventory">
          {inventory.length === 0 ? (
            <div className="inventory-empty">何も持っていない</div>
          ) : (
            inventory.map((item) => {
              const def = itemDefOf(item.itemId);
              return (
                <button
                  key={item.id}
                  className="inventory-item"
                  onClick={() => onAction({ type: 'useItem', instanceId: item.id })}
                >
                  <span className="glyph">{def.glyph}</span>
                  <span>{def.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      <div className="actions">
        <button
          className={inventoryOpen ? 'on' : ''}
          disabled={!playing}
          onClick={onToggleInventory}
        >
          持ち物 {inventory.length > 0 ? `(${inventory.length})` : ''}
        </button>
        <button
          disabled={!playing || !hasItemHere}
          onClick={() => onAction({ type: 'pickUp' })}
        >
          拾う
        </button>
        <button
          disabled={!playing || !onStairs}
          onClick={() => onAction({ type: 'descend' })}
        >
          降りる
        </button>
        <button disabled={!playing} onClick={() => onAction({ type: 'wait' })}>
          待機
        </button>
      </div>
    </>
  );
}
