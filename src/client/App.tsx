import { useEffect, useState } from 'react';
import { ActionBar } from './ActionBar';
import { FloorView } from './FloorView';
import { Lobby } from './Lobby';
import { PartyBar } from './PartyBar';
import { useGame } from './useGame';
import { itemAt, tileAt, type Dir, type Intent } from '../shared/types';

/** 締め切りまでの残り秒。待っていないときは null */
function useSecondsLeft(deadlineAt: number | null): number | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (deadlineAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  if (deadlineAt === null) return null;
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}

export function App() {
  const conn = useGame();
  const [inventoryOpen, setInventoryOpen] = useState(false);

  const deadlineAt = conn.status === 'open' ? conn.state.deadlineAt : null;
  const secondsLeft = useSecondsLeft(deadlineAt);

  // PC 向けの矢印キー操作。スマホのタップと同じ Intent を送るだけ。
  useEffect(() => {
    if (conn.status !== 'open') return;
    if (conn.state.phase !== 'playing') return;

    const keyToDir: Record<string, Dir> = {
      ArrowUp: 'n',
      ArrowDown: 's',
      ArrowRight: 'e',
      ArrowLeft: 'w',
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const dir = keyToDir[e.key];
      if (dir) {
        e.preventDefault();
        conn.send({ type: 'move', dir });
      } else if (e.key === '.') {
        conn.send({ type: 'wait' });
      } else if (e.key === 'g') {
        conn.send({ type: 'pickUp' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [conn]);

  if (conn.status === 'connecting') {
    return <div className="notice">サーバーに接続中…</div>;
  }

  if (conn.status === 'closed') {
    return (
      <div className="notice">
        <p>サーバーとの接続が切れました。</p>
        <p className="hint">ページをリロードしてください。</p>
      </div>
    );
  }

  if (conn.status === 'error') {
    return (
      <div className="notice">
        <p>{conn.message}</p>
        <p className="hint">
          サーバーが起動しているか確認してください（npm run dev）
        </p>
      </div>
    );
  }

  const { state, myId, send, start, inviteUrl } = conn;

  if (state.phase === 'lobby') {
    return <Lobby state={state} myId={myId} inviteUrl={inviteUrl} onStart={start} />;
  }

  const me = state.actors.find((a) => a.id === myId);
  const onStairs = me ? tileAt(state.floor, me.pos.x, me.pos.y) === 'stairs' : false;
  const hasItemHere = me ? itemAt(state, me.pos.x, me.pos.y) !== undefined : false;

  // 自分はもう動いたが、仲間を待っている状態
  const iActed = me !== undefined && me.alive && !state.waitingFor.includes(myId);
  const waitingCount = state.waitingFor.length;
  const playing = state.phase === 'playing' && me?.alive === true;

  const act = (intent: Intent) => {
    send(intent);
    if (intent.type === 'useItem') setInventoryOpen(false);
  };

  return (
    <div className="app">
      <header className="status">
        <span>{state.floor.depth}F</span>
        <span>
          {me ? `HP ${me.hp}/${me.maxHp}` : '—'}
          {me && (
            <span className="stats">
              {' '}
              攻{me.atk} 防{me.def}
            </span>
          )}
        </span>
        <span className="turn">{state.turn} ターン</span>
      </header>

      <PartyBar state={state} myId={myId} />

      {state.phase === 'won' && <div className="banner win">踏破した！</div>}
      {state.phase === 'lost' && (
        <div className="banner lose">全滅した… リロードでもう一度</div>
      )}
      {state.phase === 'playing' && me && !me.alive && (
        <div className="banner lose">力尽きた。仲間の戦いを見守る</div>
      )}
      {state.phase === 'playing' && iActed && waitingCount > 0 && (
        <div className="banner waiting">
          仲間を待っています（残り {waitingCount} 人）
          {secondsLeft !== null && ` あと ${secondsLeft} 秒`}
        </div>
      )}

      <FloorView
        state={state}
        myId={myId}
        onMove={(dir) => act({ type: 'move', dir })}
      />

      <div className="log">
        {state.log.slice(-2).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>

      <ActionBar
        state={state}
        myId={myId}
        onAction={act}
        onStairs={onStairs}
        hasItemHere={hasItemHere}
        playing={playing}
        inventoryOpen={inventoryOpen}
        onToggleInventory={() => setInventoryOpen((v) => !v)}
      />
    </div>
  );
}
