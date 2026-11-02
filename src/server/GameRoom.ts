import { Room, type Client } from 'colyseus';
import {
  MAX_PLAYERS,
  TURN_LIMIT_MS,
  VERSUS_PLAYERS,
  teamOf,
  type Actor,
  type GameMode,
  type GameState,
  type Intent,
  type TeamId,
} from '../shared/types';
import { isDungeonId, type DungeonId } from '../shared/dungeons';
import { isJobId } from '../shared/jobs';
import { isPerkId } from '../shared/perks';
import {
  addPlayer,
  chooseJob,
  createInitialGame,
  fillWithBots,
  pushLog,
  removePlayer,
  setLoadout,
  setPlayerName,
  setSkillPick,
  startGame,
} from './game';
import { viewFor } from './view';
import { rearrange } from './backpack';
import { retireCleanup } from './resolve';
import { takePerk } from './levels';
import { resolveTurn } from './resolve';
import { updateVision } from './vision';

/** 回線が切れた人を待つ秒数。スマホでアプリを切り替えた程度では落とさない */
const RECONNECT_SECONDS = 30;

/**
 * ゲームの部屋。
 *
 * やりとりは3種類:
 *   クライアント → サーバー : "intent"（行動） / "start"（探索開始）
 *   サーバー → クライアント : "state"（GameState 全体を JSON で）
 *
 * 同期ターン制（設計書 §5）。全員の行動が揃うか、20秒経つと1ターン進む。
 */
export class GameRoom extends Room {
  maxClients = MAX_PLAYERS;

  private game: GameState = createInitialGame();
  private intents = new Map<string, Intent>();
  /** 回線が切れて復帰を待っている人。この人のせいでターンを止めない */
  private away = new Set<string>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 部屋を作るときに、どのダンジョンへ潜るかが決まる。
   * 途中から入ってきた人は選べない（行き先が変わると、もう入っている人が困る）。
   */
  onCreate(options?: { dungeon?: unknown; mode?: unknown }): void {
    /*
     * 協力か対戦か。**部屋を作るときにしか決まらない。**
     * 途中で切り替えられるようにすると、盤（鏡像かどうか）を
     * 作り直すことになり、すでに入っている人の位置が消える。
     */
    const mode: GameMode = options?.mode === 'versus' ? 'versus' : 'coop';
    const dungeon = isDungeonId(options?.dungeon) ? (options.dungeon as DungeonId) : 'ruin';
    if (mode === 'versus' || isDungeonId(options?.dungeon)) {
      this.game = createInitialGame(dungeon, mode);
    }
    // 対戦の定員は TEAM_SIZE から決まる（1vs1 なら2人）。
    // 人数を2か所に書かないために、ここも定数から引く
    if (mode === 'versus') this.maxClients = VERSUS_PLAYERS;

    this.onMessage<Intent>('intent', (client, intent) => {
      if (this.game.phase !== 'playing') return;
      if (!this.canAct(client.sessionId)) return;

      this.intents.set(client.sessionId, intent);
      this.startTurnTimer();

      // ターンが揃わなかったときも「誰を待っているか」は配る。
      // これが無いと、先に動いた人の画面が無反応に見える。
      if (!this.tryResolveTurn()) this.publish();
    });

    /*
     * 持ち込み。ホームの倉庫から選んだものを、始めるときに袋へ入れる。
     *
     * **クライアントの自己申告を信じている。** 倉庫はブラウザの localStorage に
     * あり、サーバーは誰が何を持ち帰ったかを覚えていない（保存先が無いので）。
     * 友達と遊ぶ範囲では困らないが、知らない人と遊ぶなら作り直しが要る。
     * 直すときはここ1か所（07_ホームと周回.md §5）。
     */
    this.onMessage<unknown>('loadout', (client, ids) => {
      if (this.game.phase !== 'lobby') return;
      if (!Array.isArray(ids)) return;
      setLoadout(this.game, client.sessionId, ids.filter((v) => typeof v === 'string'));
      this.publish();
    });

    /*
     * あきらめる。
     *
     * 持ち帰れるのは踏破したときだけ（07_ホームと周回.md §1）なので、
     * ここで帰っても袋の中身は残らない。倒れたのと同じ扱いにする。
     * 置いたのは、**詰んだときに帰る手段が無かった**から。
     * 松明が尽きて階段も見つからないと、死ぬまで歩くしかなかった。
     *
     * 一緒に潜っている人がいるのに1人の判断で終わらせない。
     * その人だけ倒れた扱いにして、全員いなくなったら終わる。
     */
    this.onMessage('retire', (client) => {
      if (this.game.phase !== 'playing') return;
      const actor = this.game.actors.find((a) => a.id === client.sessionId);
      if (!actor || !actor.alive) return;

      actor.alive = false;
      actor.hp = 0;
      actor.left = true;
      pushLog(this.game, `${actor.slot}番はダンジョンを去った`);
      retireCleanup(this.game);
      this.publish();
      this.tryResolveTurn();
    });

    this.onMessage<unknown>('name', (client, name) => {
      if (typeof name !== 'string') return;
      setPlayerName(this.game, client.sessionId, name);
      this.publish();
    });

    this.onMessage<unknown>('skillpick', (client, skillId) => {
      setSkillPick(this.game, client.sessionId, typeof skillId === 'string' ? skillId : null);
    });

    this.onMessage('start', () => {
      if (this.game.phase !== 'lobby') return;
      /*
       * 対戦は、空いている席を AI で埋めてから始める（段階 D6）。
       * **人間が1人でも始められる**ことが、対戦を作りながら確かめる唯一の手段。
       */
      fillWithBots(this.game);
      startGame(this.game);
      updateVision(this.game);
      this.publish();
    });

    // 職業えらび。ロビーの間だけ受け付ける（game.ts 側でも弾いている）
    this.onMessage<unknown>('job', (client, job) => {
      if (!isJobId(job)) return;
      chooseJob(this.game, client.sessionId, job);
      this.publish();
    });

    /*
     * レベルアップのカードを選ぶ。
     *
     * **ターンの行動ではない。** intent として扱うと、
     * カードを選ぶために1ターン使うことになり、
     * しかも全員がその人の選択を待つことになる（同期ターン制なので）。
     * 別のメッセージにしておけば、選んでいる間もゲームは進む。
     */
    /*
     * バックパックの並べ替え。**ターンの行動ではない。**
     * 1マス動かすたびに1手使うのでは誰も詰め直さないし、
     * 同期ターン制なので全員がその人の整理を待つことになる。
     */
    this.onMessage<{ instanceId?: unknown; x?: unknown; y?: unknown; rot?: unknown }>(
      'rearrange',
      (client, msg) => {
        if (typeof msg?.instanceId !== 'string') return;
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
        const rot = typeof msg.rot === 'number' ? msg.rot : 0;
        if (rearrange(this.game, client.sessionId, msg.instanceId, { x: msg.x, y: msg.y }, rot)) {
          this.publish();
        }
      },
    );

    this.onMessage<unknown>('perk', (client, perkId) => {
      if (!isPerkId(perkId)) return;
      const actor = this.game.actors.find((a) => a.id === client.sessionId);
      if (!actor) return;
      if (takePerk(this.game, actor, perkId)) this.publish();
    });
  }

  onJoin(client: Client): void {
    this.away.delete(client.sessionId);
    addPlayer(this.game, client.sessionId);
    updateVision(this.game);
    this.publish();
  }

  /**
   * 切断されたとき。
   *
   * まず「待ち」から外して残りの人でターンを進められるようにする。
   * その上で 30 秒だけ復帰を待つ。戻ってこなければ盤から消す。
   */
  async onLeave(client: Client): Promise<void> {
    const id = client.sessionId;

    this.intents.delete(id);
    this.away.add(id);
    pushLog(this.game, '仲間の回線が切れた');
    this.publish();
    this.tryResolveTurn();

    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      this.away.delete(id);
      pushLog(this.game, '仲間が戻ってきた');
    } catch {
      this.away.delete(id);
      removePlayer(this.game, id);
      pushLog(this.game, '仲間はダンジョンを去った');
    }

    updateVision(this.game);
    this.publish();
    this.tryResolveTurn();
  }

  // --- ターンの進行 ---

  /**
   * 行動を待っている相手。死んだ人と回線が切れた人は待たない。
   *
   * **AI の駒も待たない。** 誰も行動を送ってこないので、
   * 待ち相手に数えるとターンが永久に止まる。
   * AI の行動は resolveTurn が解決の直前にまとめて決める（duel.ts）。
   */
  private activePlayers(): Actor[] {
    return this.game.actors.filter(
      (a) => a.kind === 'player' && a.alive && !a.bot && !this.away.has(a.id),
    );
  }

  /**
   * 行動を送れるか。倒れた人も送れる（歩くだけだが偵察役になれる）。
   * ただし activePlayers には入らないので、ターンを止めはしない。
   */
  private canAct(id: string): boolean {
    return this.game.actors.some(
      (a) => a.id === id && a.kind === 'player' && !this.away.has(a.id),
    );
  }

  /**
   * そのターンで最初の誰かが動いた瞬間から 20 秒を計る。
   * 1人で遊んでいるときは動かさない（急かす相手がいないので）。
   */
  private startTurnTimer(): void {
    if (this.turnTimer) return;
    if (this.activePlayers().length < 2) return;

    this.game.deadlineAt = Date.now() + TURN_LIMIT_MS;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      // 届いていない人は「待機」として扱って、とにかく進める
      this.resolveNow();
    }, TURN_LIMIT_MS);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.game.deadlineAt = null;
  }

  /** 揃っていれば解決して true。まだなら false */
  private tryResolveTurn(): boolean {
    if (this.game.phase !== 'playing') return false;

    const players = this.activePlayers();
    if (players.length === 0) return false;
    if (!players.every((p) => this.intents.has(p.id))) return false;

    this.resolveNow();
    return true;
  }

  private resolveNow(): void {
    if (this.game.phase !== 'playing') return;

    this.clearTurnTimer();
    resolveTurn(this.game, this.intents);
    this.intents.clear();
    this.publish();
  }

  /** その人のチーム。盤にいなければ null（見物人） */
  private teamFor(sessionId: string): TeamId | null {
    const actor = this.game.actors.find((a) => a.id === sessionId);
    return actor ? teamOf(actor) : null;
  }

  /**
   * 待ち状況を詰め直してから配る。
   *
   * ## 1人ずつ送っている理由（03_改善構成.md 段階D D2）
   *
   * 以前はここが `this.broadcast('state', this.game)` の1行だった。
   * 全員に同じものを配る限り、**対戦で相手の位置を隠す場所がどこにも無い。**
   * 配る直前にその人向けに削るのが唯一の正しい場所なので、
   * まずここをループに変えた。
   *
   * 協力モードでは viewFor が state をそのまま返すので、
   * **broadcast と1バイトも変わらない。** 段階 D2 を単独で入れたときに
   * 見た目の変化がゼロだったのはこのため。
   */
  private publish(): void {
    this.game.waitingFor = this.activePlayers()
      .filter((p) => !this.intents.has(p.id))
      .map((p) => p.id);

    if (this.game.waitingFor.length === 0) this.game.deadlineAt = null;

    for (const client of this.clients) {
      client.send('state', viewFor(this.game, this.teamFor(client.sessionId)));
    }
  }

  onDispose(): void {
    this.clearTurnTimer();
  }
}
