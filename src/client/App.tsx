import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionBar } from './ActionBar';
import { DPad } from './DPad';
import { FloorView } from './FloorView';
import { Icon } from './Icon';
import { Board3D } from './Board3D';
import { GameMenu } from './GameMenu';
import { TutorialGuide } from './Tutorial';
import { HowTo } from './HowTo';
import { LevelUp } from './LevelUp';
import { Lobby } from './Lobby';
import { MiniMap } from './MiniMap';
import { PartyBar } from './PartyBar';
import { dirBetween, findPath, shouldStop } from './travel';
import { goToDungeon, goToVersus, useGame } from './useGame';
import { DURATION } from './motion';
import { Draft } from './Draft';
import { useSecondsLeft } from './clock';
import { recordRun, loadProfile } from './profile';
import { bringHome, markCleared, markTutorialDone, rememberSkills, spendFromStash } from './stash';
import { useTurnEffects } from './useTurnEffects';
import { sfx } from './sfx';
import type { ItemId } from '../shared/items';
import {
  FUEL_DANGER,
  FUEL_WARN,
  MAX_LEVEL,
  effectiveAtk,
  effectiveDef,
  expToNext,
  itemAt,
  tileAt,
  type Dir,
  type Intent,
  type Pos,
} from '../shared/types';

/**
 * 自動で歩くときの1歩の間隔。歩きのアニメより少し短く。
 * 同じにすると間延びし、短すぎると瞬間移動に見える。
 *
 * アニメを 0.7 倍の速さに落としたので、ここも合わせて伸ばす。
 * 置いていくと、歩き終わる前に次の1歩が始まって足が流れる。
 */
const STEP_MS = Math.round(DURATION.moved * 1000 * 0.7);

export function App() {
  const conn = useGame();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * 盤の描き方。既定は 3D（three.js）。
   *
   * `?v=2d` を付けると、以前の CSS Grid 版に戻る。
   * 3D 版にはまだ無い動き（わざの演出、種族ごとの攻撃モーションなど）が
   * あるので、見比べる手段を残してある。移し終えたらこの旗ごと消す。
   */
  const board3d = new URLSearchParams(window.location.search).get('v') !== '2d';
  /** 「あとで」で閉じたレベルアップ画面。溜まった回数が増えたらまた出す */
  const [perkSnoozed, setPerkSnoozed] = useState(0);
  /** ホームで持ち込んだもの。決着したときに倉庫から引くのに使う */
  const broughtRef = useRef<ItemId[]>([]);

  /*
   * 遠いマスを押したときの道のり。
   *
   * 1ターンに1歩ずつ送る。残りを ref ではなく state に持つのは、
   * 道のりを盤に描いて目で追えるようにするため。
   * 止める条件は travel.ts の shouldStop にまとめてある。
   */
  const [path, setPath] = useState<Pos[]>([]);
  const hpRef = useRef(0);
  /**
   * 最後に1歩送ったターン。
   *
   * これが無いと、道を入れた瞬間（まだサーバーが動いていない）に
   * 次の1歩を判定してしまい、「道から外れた」と誤判定して1歩で止まる。
   * 実際そうなっていた。**ターンが進んでから次を送る。**
   */
  const steppedAtRef = useRef(-1);

  /*
   * 画面に渡す関数は使い回す。毎回作り直すと、受け取った側の useEffect が
   * レンダーのたびに走って送信の輪になる（useGame.ts に経緯）。
   */
  /*
   * 名前は繋がった時点で一度だけ送る。
   * ホームで変えたときは ProfileSheet から改めて送られる。
   */
  const sendName = conn.status === 'open' ? conn.setPlayerName : null;
  useEffect(() => {
    if (!sendName) return;
    const name = loadProfile().name;
    if (name) sendName(name);
  }, [sendName]);

  const sendLoadout = conn.status === 'open' ? conn.setLoadout : null;
  const takeLoadout = useCallback(
    (items: ItemId[]) => {
      broughtRef.current = items;
      sendLoadout?.(items);
    },
    [sendLoadout],
  );

  const deadlineAt = conn.status === 'open' ? conn.state.deadlineAt : null;
  const secondsLeft = useSecondsLeft(deadlineAt);

  // フックは条件付きで呼べないので、繋がっていないときは null を渡す
  const turnEffects = useTurnEffects(
    conn.status === 'open' ? conn.state : null,
    conn.status === 'open' ? conn.myId : null,
  );


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

  /*
   * 自動で1歩進める。
   *
   * ターンが進むたびに呼ばれる。危ないと思ったら即やめる
   * （自動で歩いている間に殴られるのが、この操作で一番腹が立つところ）。
   */
  const turnNow = conn.status === 'open' ? conn.state.turn : -1;
  useEffect(() => {
    if (conn.status !== 'open') return;
    if (path.length === 0) return;
    // まだターンが進んでいない。進むまで次の1歩は送らない
    if (turnNow === steppedAtRef.current) return;
    if (conn.state.phase !== 'playing') {
      setPath([]);
      return;
    }
    if (shouldStop(conn.state, conn.myId, hpRef.current)) {
      setPath([]);
      return;
    }

    const me = conn.state.actors.find((a) => a.id === conn.myId);
    if (!me) return;
    hpRef.current = me.hp;

    // すでに着いていたら終わり
    const next = path[0];
    if (me.pos.x === next.x && me.pos.y === next.y) {
      setPath(path.slice(1));
      return;
    }
    const dir = dirBetween(me.pos, next);
    if (!dir) {
      // 道から外れた（押し出されたなど）。引き直さずにやめる
      setPath([]);
      return;
    }
    /*
     * 少し待ってから送る。
     *
     * 1人で遊んでいるとターンが即座に解決するので、待たずに送ると
     * 5マスが 0.2 秒で終わり、歩きのアニメ（0.32秒）が追いつかない。
     * 瞬間移動しているように見えるうえ、道のりの印も見えない。
     * 歩いて見える速さに合わせる。
     */
    steppedAtRef.current = turnNow;
    const timer = setTimeout(() => {
      conn.send({ type: 'move', dir });
      setPath((now) => now.slice(1));
    }, STEP_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnNow, path.length]);

  // 決着の音は1回だけ
  const phase = conn.status === 'open' ? conn.state.phase : null;
  useEffect(() => {
    if (phase === 'won') sfx.win();
    if (phase === 'lost') sfx.lose();
  }, [phase]);

  /*
   * 踏破したら袋の中身を倉庫へ。倒れたら何も持ち帰らない。
   *
   * ここが周回の芯。「もう1階だけ潜るか、ここで引き返すか」は、
   * 持ち帰れるものが失われるからこそ悩める。
   * 持ち込んだぶんは倉庫から引いてあるので、二重には増えない。
   */
  const settled = conn.status === 'open' && (phase === 'won' || phase === 'lost');
  useEffect(() => {
    if (!settled || conn.status !== 'open') return;
    const carried = conn.state.items
      .filter((i) => i.ownerId === conn.myId && i.at !== null)
      .map((i) => i.itemId as ItemId);

    /*
     * 対戦も**何も払い出さない。**
     *
     * 倉庫・踏破数・経験は協力の周回（07_ホームと周回.md）の仕組みで、
     * 対戦はその外にある。勝つと装備が増える形にすると、
     * 勝った人がさらに強い装備で次の対戦に出てくることになり、
     * 「運で負けた」の代わりに「周回量で負けた」が生まれる。
     */
    if (conn.state.mode === 'versus') {
      broughtRef.current = [];
      return;
    }

    /*
     * チュートリアルは**何も払い出さない。**
     * 経験も倉庫も踏破数も動かさない。
     * 動かすと、剣が1本もらえる練習場を何度でも回せてしまう。
     */
    if (conn.state.dungeon === 'tutorial') {
      if (phase === 'won') markTutorialDone();
      broughtRef.current = [];
      return;
    }

    // 遊んだ量を記録する。死んでも深さぶんは残る（profile.ts）
    recordRun(conn.state.floor.depth, phase === 'won');

    if (phase === 'won') {
      bringHome(carried);
      markCleared(conn.state.dungeon);
      const mine = conn.state.actors.find((a) => a.id === conn.myId);
      if (mine?.job) rememberSkills(mine.job, mine.skills);
    }
    // 持ち込んだぶんは、勝っても負けても倉庫から消す。
    // 勝った場合は carried に含まれて戻ってくる
    spendFromStash(broughtRef.current);
    broughtRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

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

  // 合流して入ってきた人（?room= 付き）は、行き先も協力／対戦も変えられない。
  // 変えると部屋ごと作り直しになり、先に入っている人が置いていかれる
  const joined = new URLSearchParams(window.location.search).get('room') !== null;

  if (state.phase === 'lobby') {
    return (
      <Lobby
        state={state}
        myId={myId}
        inviteUrl={inviteUrl}
        onStart={start}
        onChooseJob={conn.chooseJob}
        onLoadout={takeLoadout}
        onSkillPick={conn.setSkillPick}
        onRename={conn.setPlayerName}
        /* 合流した人は行き先を変えられない。変えると先に入っている人が困る */
        onChooseDungeon={joined ? null : goToDungeon}
        /* 協力 ⇄ 対戦も同じ。部屋ごと作り直すので、合流した人は変えられない */
        onVersus={joined ? null : goToVersus}
      />
    );
  }

  /*
   * 支度（段階D D8）。ロビーと盤の間に挟まる、対戦だけの画面。
   * AI の番はサーバー側で自動で進むので、ここに待ちの仕掛けは要らない。
   */
  if (state.phase === 'draft') {
    return <Draft state={state} myId={myId} onPick={conn.draftPick} />;
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
    // 手で何かした時点で、自動で歩くのはやめる
    setPath([]);
    send(intent);
    if (intent.type === 'useItem') setInventoryOpen(false);
    if (intent.type === 'skill') setSkillsOpen(false);
  };

  /** 遠いマスを押したとき。そこまでの道を引いて、1歩目をすぐ送る */
  const travelTo = (to: Pos) => {
    if (!me) return;
    const route = findPath(state, me.pos, to);
    if (!route) return;
    hpRef.current = me.hp;
    steppedAtRef.current = state.turn;
    // 1歩目はすぐ送る。押してから次のターンまで何も起きないと、押せていないように見える
    const dir = dirBetween(me.pos, route[0]);
    if (!dir) return;
    send({ type: 'move', dir });
    setPath(route.slice(1));
  };

  return (
    <div className="app">
      <header className="status">
        <span>{state.floor.depth}F</span>
        {me && <span className="level">Lv{me.level}</span>}
        <span>
          {me ? `HP ${me.hp}/${me.maxHp}` : '—'}
          {me && (
            // 装備ぶんを足した実際の値を出す。素の値を出すと、
            // 剣を持っているのに数字が変わらず「効いていない」ように見える
            <span className="stats">
              {' '}
              攻{effectiveAtk(state, me)} 防{effectiveDef(state, me)}
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
            <Icon id="torch2" size={16} /> {me.fuel}
          </span>
        )}
        {/*
          開門まで（段階D D7）。
          **残りターンを出す。** 出さないと、歩き回っているうちに
          いきなり相手が来る。前半に支度をさせるための仕掛けなので、
          いつ終わるかが見えていないと仕掛けとして成立しない。
        */}
        {state.gate && !state.gate.open ? (
          <span className="gate-left">
            <Icon id="lock" size={16} /> {Math.max(0, state.gate.opensAt - state.turn)}
          </span>
        ) : (
          <span className="turn">{state.turn}</span>
        )}
        {/*
          ここは地図と歯車の2つだけにする。
          行動ボタンの列に足すと 375px でボタンが細くなって押し間違えるし、
          ヘッダーに3つ並べるとステータスの数字を押しのけ始めた。
          音・設定・あきらめるは歯車の中へ。
          地図は遊んでいる最中に何度も開くので外に残す。
        */}
        <button
          className="mute"
          aria-label="全体マップ"
          aria-pressed={mapOpen}
          onClick={() => setMapOpen((v) => !v)}
        >
          <Icon id="map" size={16} />
        </button>
        <button className="mute" aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          <Icon id="cog" size={16} />
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

      {/* やることを1行で出す。チュートリアルのときだけ */}
      {state.dungeon === 'tutorial' && state.phase === 'playing' && me && (
        <TutorialGuide state={state} me={me} />
      )}

      {/*
        対戦の決着。協力の「踏破した！」とは別の文面にする。
        相手を倒して終わったのに「踏破した！ 42 ターン」と出ると、
        何に勝ったのか分からない。
      */}
      {state.mode === 'versus' && (state.phase === 'won' || state.phase === 'lost') && (
        <div className={`banner ${state.phase === 'won' ? 'win' : 'lose'}`}>
          {/*
            引き分けは「負けた…」と書かない（段階D D9）。
            時間切れで並んだときに負け扱いにされると、
            何が足りなかったのか分からないまま終わる。
            winner が立っていなければ、どちらも勝っていない。
          */}
          <span>
            {state.winner === undefined
              ? '引き分け'
              : state.phase === 'won'
                ? '勝った！'
                : '負けた…'}{' '}
            {state.turn} ターン
          </span>
          <button onClick={() => location.reload()}>もう一度</button>
        </div>
      )}
      {state.mode !== 'versus' && state.phase === 'won' && (
        <div className="banner win">
          {/*
            チュートリアルを「踏破した！」とは呼ばない。練習に記録は要らない。
            終わったら本編へ送り出す。ここで「もう一度」を出すと、
            覚えた人をもう一度チュートリアルに戻すことになる。
          */}
          {state.dungeon === 'tutorial' ? (
            <>
              <span>ひととおり覚えた！</span>
              <button onClick={() => (location.href = '/')}>ホームへ</button>
            </>
          ) : (
            <>
              <span>踏破した！ {state.turn} ターン</span>
              <button onClick={() => location.reload()}>もう一度</button>
            </>
          )}
        </div>
      )}
      {state.mode !== 'versus' && state.phase === 'lost' && (
        <div className="banner lose">
          <span>
            {/* 自分で帰ったのに「全滅」と言われると、負かされた気分になる */}
            {state.lostBy === 'left'
              ? `${state.floor.depth}F から引き返した`
              : `${state.floor.depth}F で全滅…`}{' '}
            {state.turn} ターン
          </span>
          <button onClick={() => location.reload()}>もう一度</button>
        </div>
      )}
      {state.phase === "playing" && me && !me.alive && (
        <div className="banner lose">
          <span>
            {me.left
              ? 'ダンジョンを去った。仲間が踏破するまで見ていられる'
              : '力尽きた。動いて仲間の目になれる'}
          </span>
        </div>
      )}
      {state.phase === 'playing' && iActed && waitingCount > 0 && (
        <div className="banner waiting">
          仲間を待っています（残り {waitingCount} 人）
          {secondsLeft !== null && ` あと ${secondsLeft} 秒`}
        </div>
      )}

      {/* 盤の描き方。既定は 3D。?v=2d で以前の CSS Grid 版 */}
      {board3d ? (
        <Board3D
          state={state}
          myId={myId}
          turnEffects={turnEffects}
          onMove={(dir) => act({ type: 'move', dir })}
          path={path}
          onTravel={travelTo}
        />
      ) : (
      <FloorView
        state={state}
        myId={myId}
        turnEffects={turnEffects}
        onMove={(dir) => act({ type: 'move', dir })}
        path={path}
        onTravel={travelTo}
      />
      )}

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
        onMoveItem={conn.moveItem}
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

      {menuOpen && (
        <GameMenu
          onClose={() => setMenuOpen(false)}
          onHowTo={() => {
            setMenuOpen(false);
            setHowToOpen(true);
          }}
          onRetire={() => {
            setMenuOpen(false);
            conn.retire();
          }}
        />
      )}

      {howToOpen && <HowTo onClose={() => setHowToOpen(false)} />}
    </div>
  );
}
