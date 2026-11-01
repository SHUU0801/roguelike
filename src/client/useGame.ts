import { useEffect, useMemo, useState } from 'react';
import { Client, type Room } from '@colyseus/sdk';
import { isDungeonId, type DungeonId } from '../shared/dungeons';
import type { ItemId } from '../shared/items';
import type { JobId } from '../shared/jobs';
import type { PerkId } from '../shared/perks';
import type { GameState, Intent } from '../shared/types';

/**
 * クライアントは `@colyseus/sdk` を使う（`colyseus.js` ではない）。
 *
 * `colyseus.js` は 0.16 系で止まっており、サーバー 0.18 のマッチメイキング応答
 * （roomId などが平坦に並んだ形）を読めずに接続が失敗する。
 * サーバー 0.18 に対応したクライアントはこちら。
 */

/**
 * サーバーの場所。
 *
 * 公開したときは、画面と WebSocket を同じサーバーが配っている。
 * だから開いている URL にそのまま繋げばよく、設定が要らない。
 * https のページでは wss でないとブラウザに拒否されるので、そこだけ合わせる。
 *
 * 開発中は Vite（5173）と Colyseus（2567）が別なので、ポートを足す。
 * localhost 固定にしないので、スマホの実機から LAN 経由で開いてもそのまま繋がる。
 *
 * VITE_SERVER_URL を設定すれば、別のサーバーを向かせることもできる。
 */
function serverUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL;
  if (override) return override;

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV) return `${scheme}://${window.location.hostname}:2567`;
  return `${scheme}://${window.location.host}`;
}

const SERVER_URL = serverUrl();

/** URL に ?room=xxxx が付いていれば、その部屋に合流する */
function wantedRoomId(): string | null {
  return new URLSearchParams(window.location.search).get('room');
}

/**
 * 行き先。URL の ?d= に入れる。
 *
 * 部屋を作るときにしか決められないので、変えるときは部屋を作り直す。
 * URL に入れておけば、作り直しがただのページ遷移で済む。
 */
const DUNGEON_KEY = 'd';

export function wantedDungeon(): DungeonId {
  const v = new URLSearchParams(window.location.search).get(DUNGEON_KEY);
  return isDungeonId(v) ? v : 'ruin';
}

export function goToDungeon(id: DungeonId): void {
  /*
   * 再接続の合い言葉を先に捨てる。
   *
   * 行き先を変えるのは同じオリジン内の遷移なので sessionStorage が残る。
   * 残っていると、新しい部屋を作るより先に `client.reconnect` が走って
   * **さっきまでいた部屋に戻ってしまう**。
   * 実際そうなって、URL は ?d=cave なのに遺跡に入っていた。
   */
  clearToken();
  window.location.search = `?${DUNGEON_KEY}=${id}`;
}

/**
 * 再接続用の合い言葉。
 *
 * スマホはアプリを切り替えただけで WebSocket が切れる。
 * サーバーは 30 秒だけ席を取っておくので、その間に同じ合い言葉で戻れば
 * 同じキャラのまま復帰できる。
 *
 * どの部屋の合い言葉かを一緒に覚えておくのが要点。
 * これが無いと、別の部屋の URL を開いたのに前の部屋へ戻されてしまう。
 */
const TOKEN_KEY = 'roguelike:reconnect';

type SavedToken = { roomId: string; token: string };

function saveToken(saved: SavedToken): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
  } catch {
    // プライベートモードなどで使えないことがある。使えなくても遊べる
  }
}

function loadToken(): SavedToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SavedToken).roomId === 'string' &&
      typeof (parsed as SavedToken).token === 'string'
    ) {
      return parsed as SavedToken;
    }
    return null;
  } catch {
    return null;
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 消せなくても困らない
  }
}

export type Connection =
  | { status: 'connecting' }
  | { status: 'error'; message: string }
  | { status: 'closed' }
  | {
      status: 'open';
      state: GameState;
      myId: string;
      roomId: string;
      inviteUrl: string;
      send: (intent: Intent) => void;
      start: () => void;
      chooseJob: (job: JobId) => void;
      /** レベルアップのカードを取る。ターンの行動ではないので intent ではない */
      takePerk: (perkId: PerkId) => void;
      /** バックパックの並べ替え。これもターンの行動ではない */
      moveItem: (instanceId: string, x: number, y: number, rot: number) => void;
      /** ホームで選んだ持ち込み */
      setLoadout: (items: ItemId[]) => void;
      /** 持ち込むわざ。職業の基本わざに加えて1つ */
      setSkillPick: (skillId: string | null) => void;
      /** 遊んでいる人の名前。仲間の一覧に出す */
      setPlayerName: (name: string) => void;
      /** あきらめて帰る。持ち物は持ち帰れない */
      retire: () => void;
    };

export function useGame(): Connection {
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let joined: Room | null = null;

    const client = new Client(SERVER_URL);
    const wanted = wantedRoomId();

    // ?room= があれば合流、無ければ新しい部屋を作る。
    // joinOrCreate を使わないのは、知らない人の部屋に勝手に入れないようにするため。
    const joinFresh = () =>
      wanted ? client.joinById(wanted) : client.create('game', { dungeon: wantedDungeon() });

    // 戻ろうとしている部屋の合い言葉を持っているときだけ再接続を試す
    const saved = loadToken();
    const canReconnect = saved !== null && (wanted === null || wanted === saved.roomId);

    const joining =
      saved && canReconnect
        ? client.reconnect(saved.token).catch(() => joinFresh())
        : joinFresh();

    joining
      .then((r) => {
        joined = r;
        if (disposed) {
          void r.leave();
          return;
        }
        r.onMessage('state', (payload) => setState(payload as GameState));
        r.onError((code, message) => setError(`通信エラー (${code}) ${message ?? ''}`));
        // 部屋が消えたら、古い状態を描き続けずに接続が切れたことを表に出す。
        // 開発中はサーバーを保存のたびに再起動するので、これが無いと
        // 「中身の違う古い状態」を描画しようとして画面が落ちる。
        r.onLeave(() => setClosed(true));
        saveToken({ roomId: r.roomId, token: r.reconnectionToken });
        setRoom(r);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        const detail = e instanceof Error ? e.message : '';
        setError(
          wanted ? `その部屋に入れない: ${detail}` : `サーバーに繋がらない: ${detail}`,
        );
      });

    return () => {
      disposed = true;
      void joined?.leave();
    };
  }, []);

  // 決着がついた部屋には戻らない。「リロードでもう一度」が効かなくなるため
  useEffect(() => {
    if (state?.phase === 'won' || state?.phase === 'lost') clearToken();
  }, [state?.phase]);

  // 開発中のデバッグ用。ブラウザのコンソールで __game.state と打つと今の盤面が見える。
  // 本番ビルドでは import.meta.env.DEV が false になるので消える。
  if (import.meta.env.DEV && room && state) {
    (window as unknown as Record<string, unknown>).__game = {
      state,
      myId: room.sessionId,
      roomId: room.roomId,
      send: (intent: Intent) => room.send('intent', intent),
      start: () => room.send('start'),
      chooseJob: (job: JobId) => room.send('job', job),
      takePerk: (perkId: PerkId) => room.send('perk', perkId),
      moveItem: (instanceId: string, x: number, y: number, rot: number) =>
        room.send('rearrange', { instanceId, x, y, rot }),
      setLoadout: (items: ItemId[]) => room.send('loadout', items),
      setSkillPick: (skillId: string | null) => room.send('skillpick', skillId),
      setPlayerName: (name: string) => room.send('name', name),
      retire: () => room.send('retire'),
    };
  }

  /*
   * 送信口は部屋ごとに1度だけ作る。
   *
   * 毎回その場で関数を作っていたら、useEffect の依存に入れた画面側が
   * **レンダーのたびに送信して無限ループ**になった。
   * 送る → サーバーが配る → 再レンダー → また送る、の輪になる。
   * 実際ホームの持ち込みで起きて、タブが勝手に戻っていた。
   */
  const api = useMemo(() => {
    if (!room) return null;
    return {
      send: (intent: Intent) => room.send('intent', intent),
      start: () => room.send('start'),
      chooseJob: (job: JobId) => room.send('job', job),
      takePerk: (perkId: PerkId) => room.send('perk', perkId),
      moveItem: (instanceId: string, x: number, y: number, rot: number) =>
        room.send('rearrange', { instanceId, x, y, rot }),
      setLoadout: (items: ItemId[]) => room.send('loadout', items),
      setSkillPick: (skillId: string | null) => room.send('skillpick', skillId),
      setPlayerName: (name: string) => room.send('name', name),
      retire: () => room.send('retire'),
    };
  }, [room]);

  if (error) return { status: 'error', message: error };
  if (closed) return { status: 'closed' };
  if (!room || !state || !api) return { status: 'connecting' };

  const base = `${window.location.origin}${window.location.pathname}`;

  return {
    status: 'open',
    state,
    myId: room.sessionId,
    roomId: room.roomId,
    inviteUrl: `${base}?room=${room.roomId}`,
    ...api,
  };
}
