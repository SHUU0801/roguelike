import { useEffect, useState } from 'react';
import { ActionBar } from './ActionBar';
import { DPad } from './DPad';
import { FloorView } from './FloorView';
import { HowTo } from './HowTo';
import { LevelUp } from './LevelUp';
import { Lobby } from './Lobby';
import { MiniMap } from './MiniMap';
import { PartyBar } from './PartyBar';
import { useGame } from './useGame';
import { useTurnEffects } from './useTurnEffects';
import { isMuted, setMuted, sfx } from './sfx';
import {
  FUEL_DANGER,
  FUEL_WARN,
  MAX_LEVEL,
  expToNext,
  itemAt,
  tileAt,
  type Dir,
  type Intent,
} from '../shared/types';

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
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  /** 「あとで」で閉じたレベルアップ画面。溜まった回数が増えたらまた出す */
  const [perkSnoozed, setPerkSnoozed] = useState(0);

  const deadlineAt = conn.status === 'open' ? conn.state.deadlineAt : null;
  const secondsLeft = useSecondsLeft(deadlineAt);

  // フックは条件付きで呼べないので、繋がっていないときは null を渡す
  const turnEffects = useTurnEffects(
    conn.status === 'open' ? conn.state : null,
    conn.status === 'open' ? conn.myId : null,
  );

  const [muted, setMutedState] = useState(isMuted);


  // ターンが進んだら、その中身に合わせて音を鳴らす。
  // 音のファイルは使わず sfx.ts がその場で合成する
  useEffect(() => {
    if (turnEffects.turn < 0) return;
    if (turnEffects.descended) sfx.descend();
    if (turnEffects.picked) sfx.pickup();
    if (turnEffects.healed) sfx.heal();
    else if (turnEffects.usedItem) sfx.use();
    if (turnEffects.selfAttacked) sfx.attack();
    if (turnEffects.ghosts.length > 0) sfx.kill();
    else if (turnEffects.selfHurt) sfx.hurt();
    else if (turnEffects.anyHit) sfx.hit();
  }, [turnEffects]);

  // 決着の音は1回だけ
  const phase = conn.status === 'open' ? conn.state.phase : null;
  useEffect(() => {
    if (phase === 'won') sfx.win();
    if (phase === 'lost') sfx.lose();
  }, [phase]);

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
      // 地図の開け閉めは盤面の操作より先に見る。開いている間でも閉じられるように
      if (e.key === 'm' || e.key === 'M') {
        setMapOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setMapOpen(false);
        return;
      }
      // 地図で盤面が隠れている間は動かさない。見えていないまま歩くことになる
      if (mapOpen) return;

      const dir = keyToDir[e.key];
      if (dir) {
        e.preventDefault();
        conn.send({ type: 'move', dir });
      } else if (e.key === '.') {
        conn.send({ type: 'wait' });
      } else if (e.key === 'g') {
        conn.send({ type: 'pickUp' });
      } else if (e.key === 's') {
        // 使える最初のわざ。一覧を開かずに撃てるようにしておく
        const mine = conn.state.actors.find((a) => a.id === conn.myId);
        const ready = mine?.skills.find(
          (id) => (mine.cooldowns[id] ?? 0) <= conn.state.turn,
        );
        if (ready) conn.send({ type: 'skill', skillId: ready });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [conn, mapOpen]);

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
    return (
      <Lobby
        state={state}
        myId={myId}
        inviteUrl={inviteUrl}
        onStart={start}
        onChooseJob={conn.chooseJob}
      />
    );
  }

  const me = state.actors.find((a) => a.id === myId);
  // 誰か1人でも階段にいれば、全員が「降りる」に同意できる。
  // 全員を階段に集めさせると待ち時間が生まれる
  const stairsReady = state.actors.some(
    (a) => a.kind === "player" && a.alive && tileAt(state.floor, a.pos.x, a.pos.y) === "stairs",
  );
  const hasItemHere = me ? itemAt(state, me.pos.x, me.pos.y) !== undefined : false;
  const canRevive =
    me !== undefined &&
    me.alive &&
    state.actors.some(
      (a) =>
        a.kind === "player" &&
        !a.alive &&
        Math.abs(a.pos.x - me.pos.x) + Math.abs(a.pos.y - me.pos.y) === 1,
    );

  // 自分はもう動いたが、仲間を待っている状態
  const iActed = me !== undefined && me.alive && !state.waitingFor.includes(myId);
  const waitingCount = state.waitingFor.length;
  const playing = state.phase === 'playing' && me?.alive === true;

  const act = (intent: Intent) => {
    send(intent);
    if (intent.type === 'useItem') setInventoryOpen(false);
    if (intent.type === 'skill') setSkillsOpen(false);
  };

  return (
    <div className="app">
      <header className="status">
        <span>{state.floor.depth}F</span>
        {me && <span className="level">Lv{me.level}</span>}
        <span>
          {me ? `HP ${me.hp}/${me.maxHp}` : '—'}
          {me && (
            <span className="stats">
              {' '}
              攻{me.atk} 防{me.def}
            </span>
          )}
        </span>
        {/* 松明の残り。これが時間のコストそのものなので、常に見えている必要がある */}
        {me && (
          <span
            className={[
              'fuel',
              me.fuel === 0 ? 'out' : me.fuel <= FUEL_DANGER ? 'danger' : me.fuel <= FUEL_WARN ? 'low' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            🔥 {me.fuel}
          </span>
        )}
        <span className="turn">{state.turn}</span>
        {/* 地図は行動ではないので、下のボタン列ではなくここに置く。
            下に5つ目を足すと 375px でボタンが細くなって押し間違える */}
        <button
          className="mute"
          aria-label="あそびかた"
          onClick={() => setHowToOpen(true)}
        >
          ❓
        </button>
        <button
          className="mute"
          aria-label="全体マップ"
          aria-pressed={mapOpen}
          onClick={() => setMapOpen((v) => !v)}
        >
          🗺
        </button>
        <button
          className="mute"
          aria-label={muted ? '音を出す' : '音を消す'}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      {/* 経験値バー。レベルが上がると未選択のカードが溜まるので、
          溜まっているときはバー自体が光って催促する */}
      {me && (
        <div className={`expbar${me.pendingLevels > 0 ? ' pending' : ''}`}>
          <i
            style={{
              width:
                me.level >= MAX_LEVEL
                  ? '100%'
                  : `${Math.min(100, (me.exp / expToNext(me.level)) * 100)}%`,
            }}
          />
          <span>
            {me.level >= MAX_LEVEL ? '最大レベル' : `${me.exp} / ${expToNext(me.level)}`}
          </span>
        </div>
      )}

      <PartyBar state={state} myId={myId} />

      {state.phase === 'won' && (
        <div className="banner win">
          <span>踏破した！ {state.turn} ターン</span>
          <button onClick={() => location.reload()}>もう一度</button>
        </div>
      )}
      {state.phase === 'lost' && (
        <div className="banner lose">
          <span>
            {state.floor.depth}F で全滅… {state.turn} ターン
          </span>
          <button onClick={() => location.reload()}>もう一度</button>
        </div>
      )}
      {state.phase === "playing" && me && !me.alive && (
        <div className="banner lose">
          <span>力尽きた。動いて仲間の目になれる</span>
        </div>
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
        turnEffects={turnEffects}
        onMove={(dir) => act({ type: 'move', dir })}
      />

      {/* 殴られた合図。key にターンを入れて、連続で殴られても毎回光らせる */}
      {turnEffects.selfHurt && <div key={state.turn} className="hurt-flash" />}

      {/*
        key に配列の添字ではなく通し番号を使う。
        添字だと新しい行が来ても同じ DOM 要素が使い回され、
        最新行を光らせるアニメーションが一度も発火しない。
      */}
      <div className="log">
        {state.log.slice(-3).map((line, i) => (
          <div key={state.log.length - 3 + i}>{line}</div>
        ))}
      </div>

      <ActionBar
        state={state}
        myId={myId}
        onAction={act}
        stairsReady={stairsReady}
        hasItemHere={hasItemHere}
        canRevive={canRevive}
        playing={playing}
        inventoryOpen={inventoryOpen}
        onToggleInventory={() => {
          setSkillsOpen(false);
          setInventoryOpen((v) => !v);
        }}
        skillsOpen={skillsOpen}
        onToggleSkills={() => {
          setInventoryOpen(false);
          setSkillsOpen((v) => !v);
        }}
      />

      {/* 歩くための十字ボタン。盤に重ねて左下に出す（DPad.tsx に理由） */}
      <DPad
        hidden={inventoryOpen || skillsOpen}
        disabled={!playing && !(me !== undefined && !me.alive && state.phase === 'playing')}
        onMove={(dir) => act({ type: 'move', dir })}
        onWait={() => act({ type: 'wait' })}
      />

      {mapOpen && <MiniMap state={state} myId={myId} onClose={() => setMapOpen(false)} />}

      {/* レベルアップのカード。盤面は後ろで進み続ける */}
      {me && me.pendingLevels > perkSnoozed && me.offers.length > 0 && (
        <LevelUp
          me={me}
          onTake={(perkId) => {
            conn.takePerk(perkId);
            setPerkSnoozed(0);
          }}
          onLater={() => setPerkSnoozed(me.pendingLevels)}
        />
      )}

      {howToOpen && <HowTo onClose={() => setHowToOpen(false)} />}
    </div>
  );
}
