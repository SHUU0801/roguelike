import { useState } from 'react';
import { itemDefOf } from '../shared/items';
import type { GameState, Intent, ItemInstance } from '../shared/types';

type Props = {
  state: GameState;
  myId: string;
  onAction: (intent: Intent) => void;
  /** 誰かが階段に立っているか。全員の同意で降りる */
  stairsReady: boolean;
  hasItemHere: boolean;
  /** 隣に倒れている仲間がいるか */
  canRevive: boolean;
  /** ゲームが終わっていたら全部押せなくする */
  playing: boolean;
  inventoryOpen: boolean;
  onToggleInventory: () => void;
};

/**
 * 画面下のアクションボタンと、持ち物の一覧。
 * ボタンは4つ1段。小さい端末で2段にすると下が画面の外に出る。
 */
export function ActionBar({
  state,
  myId,
  onAction,
  stairsReady,
  hasItemHere,
  canRevive,
  playing,
  inventoryOpen,
  onToggleInventory,
}: Props) {
  const players = state.actors.filter((a) => a.kind === 'player');
  const [tab, setTab] = useState<string>(myId);
  const viewing = players.some((p) => p.id === tab) ? tab : myId;

  const mine: ItemInstance[] = state.items.filter((i) => i.ownerId === myId);
  const shown: ItemInstance[] = state.items.filter((i) => i.ownerId === viewing);
  const isMine = viewing === myId;

  const readyCount = state.descendReady.length;
  const aliveCount = players.filter((p) => p.alive).length;

  return (
    <>
      {inventoryOpen && (
        <div className="inventory">
          {/*
            仲間の持ち物は既に全員の手元に届いている（state をまるごと配っているので）。
            見せていなかっただけ。「薬草が1個もない」を全員が同時に見られて初めて、
            「じゃあ俺が渡す」が言える。
          */}
          {players.length > 1 && (
            <div className="inv-tabs">
              {players.map((p) => (
                <button
                  key={p.id}
                  className={p.id === viewing ? 'on' : ''}
                  onClick={() => setTab(p.id)}
                >
                  {p.id === myId ? 'あなた' : `${p.slot}番`}
                  <span className="count">
                    {state.items.filter((i) => i.ownerId === p.id).length}
                  </span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="inventory-empty">
              {isMine ? '何も持っていない' : 'この人は何も持っていない'}
            </div>
          ) : (
            shown.map((item) => {
              const def = itemDefOf(item.itemId);
              return (
                <div key={item.id} className="inventory-row">
                  <span className="glyph">{def.glyph}</span>
                  <span className="iname">{def.name}</span>
                  {isMine && playing && (
                    <>
                      <button
                        onClick={() => onAction({ type: 'useItem', instanceId: item.id })}
                      >
                        使う
                      </button>
                      {/* 渡す唯一の手段。置いて、相手に拾ってもらう */}
                      <button
                        onClick={() => onAction({ type: 'drop', instanceId: item.id })}
                      >
                        置く
                      </button>
                    </>
                  )}
                </div>
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
          持ち物 {mine.length > 0 ? `(${mine.length})` : ''}
        </button>

        {/* 隣に倒れた仲間がいるときだけ「起こす」に化ける */}
        {canRevive ? (
          <button className="ready" disabled={!playing} onClick={() => onAction({ type: 'revive' })}>
            起こす
          </button>
        ) : (
          <button
            className={playing && hasItemHere ? 'ready' : ''}
            disabled={!playing || !hasItemHere}
            onClick={() => onAction({ type: 'pickUp' })}
          >
            拾う
          </button>
        )}

        <button
          className={playing && stairsReady ? 'ready' : ''}
          disabled={!playing || !stairsReady}
          onClick={() => onAction({ type: 'descend' })}
        >
          降りる{stairsReady && aliveCount > 1 ? ` ${readyCount}/${aliveCount}` : ''}
        </button>

        <button disabled={!playing} onClick={() => onAction({ type: 'wait' })}>
          待機
        </button>
      </div>
    </>
  );
}
