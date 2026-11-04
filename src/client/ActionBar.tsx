import { useState } from 'react';
import { Backpack } from './Backpack';
import { Icon } from './Icon';
import { itemDefOf } from '../shared/items';
import { skillOf } from '../shared/skills';
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
  skillsOpen: boolean;
  onToggleSkills: () => void;
  onMoveItem: (instanceId: string, x: number, y: number, rot: number) => void;
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
  skillsOpen,
  onToggleSkills,
  onMoveItem,
}: Props) {
  const players = state.actors.filter((a) => a.kind === 'player');
  const [tab, setTab] = useState<string>(myId);
  const viewing = players.some((p) => p.id === tab) ? tab : myId;

  const mine: ItemInstance[] = state.items.filter((i) => i.ownerId === myId);
  const isMine = viewing === myId;

  const readyCount = state.descendReady.length;
  const aliveCount = players.filter((p) => p.alive).length;

  const me = players.find((p) => p.id === myId);
  const skills = me?.skills ?? [];
  const waitOf = (id: string) => Math.max(0, (me?.cooldowns[id as never] ?? 0) - state.turn);
  const anyReady = skills.some((id) => waitOf(id) === 0);

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

          <Backpack
            state={state}
            ownerId={viewing}
            mine={isMine}
            canArrange={playing}
            canAct={playing}
            onUse={(id) => onAction({ type: 'useItem', instanceId: id })}
            onDrop={(id) => onAction({ type: 'drop', instanceId: id })}
            onToggleEquip={(id) => onAction({ type: 'toggleEquip', instanceId: id })}
            onMove={onMoveItem}
          />
        </div>
      )}

      {skillsOpen && (
        <div className="inventory">
          {skills.length === 0 ? (
            <div className="inventory-empty">覚えているわざがない</div>
          ) : (
            skills.map((id) => {
              const def = skillOf(id);
              const wait = waitOf(id);
              return (
                <div key={id} className="inventory-row skill-row">
                  <Icon id={def.icon} size={32} />
                  <span className="iname">
                    {def.name}
                    <span className="sdesc">{def.desc}</span>
                  </span>
                  {/* 押せない理由を数字で出す。「押せないボタン」にしない */}
                  <button
                    className={wait === 0 ? 'ready' : ''}
                    disabled={!playing || wait > 0}
                    onClick={() => onAction({ type: 'skill', skillId: id })}
                  >
                    {wait === 0 ? '使う' : `あと${wait}`}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="actions">
        {/*
          わざは一覧にする。覚えると増えていくので、ボタンを1つずつ足すと
          375px の横幅がすぐ尽きる。持ち物と同じ形にしておけば、
          増えても画面の作りが変わらない。
        */}
        <button
          className={[skillsOpen ? 'on' : '', playing && anyReady ? 'ready' : '']
            .filter(Boolean)
            .join(' ')}
          disabled={!playing || skills.length === 0}
          onClick={onToggleSkills}
        >
          わざ ({skills.length})
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
