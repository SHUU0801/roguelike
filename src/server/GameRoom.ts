import { Room, type Client } from 'colyseus';
import {
  MAX_PLAYERS,
  TURN_LIMIT_MS,
  type Actor,
  type GameState,
  type Intent,
} from '../shared/types';
import { addPlayer, createInitialGame, pushLog, removePlayer, startGame } from './game';
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

  onCreate(): void {
    this.onMessage<Intent>('intent', (client, intent) => {
      if (this.game.phase !== 'playing') return;
      if (!this.isActive(client.sessionId)) return;

      this.intents.set(client.sessionId, intent);
      this.startTurnTimer();

      // ターンが揃わなかったときも「誰を待っているか」は配る。
      // これが無いと、先に動いた人の画面が無反応に見える。
      if (!this.tryResolveTurn()) this.publish();
    });

    this.onMessage('start', () => {
      if (this.game.phase !== 'lobby') return;
      startGame(this.game);
      updateVision(this.game);
      this.publish();
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

  /** 行動を待っている相手。死んだ人と回線が切れた人は待たない */
  private activePlayers(): Actor[] {
    return this.game.actors.filter(
      (a) => a.kind === 'player' && a.alive && !this.away.has(a.id),
    );
  }

  private isActive(id: string): boolean {
    return this.activePlayers().some((a) => a.id === id);
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

  /** 待ち状況を詰め直してから配る */
  private publish(): void {
    this.game.waitingFor = this.activePlayers()
      .filter((p) => !this.intents.has(p.id))
      .map((p) => p.id);

    if (this.game.waitingFor.length === 0) this.game.deadlineAt = null;

    this.broadcast('state', this.game);
  }

  onDispose(): void {
    this.clearTurnTimer();
  }
}
