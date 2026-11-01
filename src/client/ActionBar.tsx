import { useState } from 'react';
import { itemDefOf } from '../shared/items';
import { jobOf } from '../shared/jobs';
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
 *
 * 歩く操作は左下の十字ボタン（DPad.tsx）に移したので、ここは
 * 「歩く以外」だけを持つ。十字ボタンと重ならないよう右側に寄せ、
 * 2列2段に畳んである。1段5つに増やすと、375px で1つ 70px を割って押しにくい。
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

  const me = players.find((p) => p.id === myId);
  const skill = jobOf(me?.job ?? null).skill;
  const skillWait = me ? Math.max(0, me.skillReadyAt - state.turn) : 0;
  const skillReady = skillWait === 0;

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
        {/* 職業スキル。待ち時間が残っている間は残りターン数を出す。
            「押せないボタン」ではなく「あと何ターンで押せるボタン」にする */}
        <button
          className={playing && skillReady ? 'skill ready' : 'skill'}
          disabled={!playing || !skillReady}
          onClick={() => onAction({ type: 'skill' })}
        >
          {skill.name}
          {!skillReady && skillWait > 0 && <span className="cd">{skillWait}</span>}
        </button>

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

      </div>
    </>
  );
}
