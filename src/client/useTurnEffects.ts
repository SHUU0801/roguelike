import { useEffect, useRef, useState } from 'react';
import { speciesOf } from '../shared/monsters';
import type { SpriteId } from '../shared/sprites';
import type { Actor, GameState, Pos } from '../shared/types';

/**
 * ターンが進んだときの「動き」を、前の状態との差分から決める。
 *
 * **サーバーにアニメーションの状態を持たせない**（04_絵とアニメの方針.md §3-4）。
 * 「今このキャラは攻撃モーション中」はサーバーの知ったことではないので、
 * クライアントが前後を見比べて自分で決める。サーバー権威の構造を壊さない。
 *
 * 見ているのは3つだけ:
 *   位置が変わった      → 元いた方向から滑り込む
 *   HP が減った         → 揺れる + 一瞬白く飛ぶ
 *   盤から消えた        → その場で回って消える（幽霊として少しだけ残す）
 *
 * 攻撃の踏み込みは「ダメージを受けた相手の隣にいて、自分は動かなかった敵対者」
 * から逆算する。攻撃したことをサーバーに報告させなくて済む。
 */

export type Effect =
  | { kind: 'moved'; dx: number; dy: number }
  | { kind: 'lunge'; dx: number; dy: number }
  | { kind: 'hit' };

/** 盤から消えた Actor を、消えるアニメーションの間だけ描くための残像 */
export type Ghost = { id: string; sprite: SpriteId; pos: Pos };

export type TurnEffects = {
  /** Actor id → その Actor に付ける動き */
  effects: Map<string, Effect>;
  ghosts: Ghost[];
  /** このターンに「こちらに気づいた」敵。❗ を出すのに使う */
  noticed: Set<string>;
  /** 自分が殴られたか。画面全体を赤く光らせるのに使う */
  selfHurt: boolean;
  /** 誰かが殴られたか（効果音に使う） */
  anyHit: boolean;
  /** 自分が攻撃したか */
  selfAttacked: boolean;
  /** 自分が何か拾ったか */
  picked: boolean;
  /** 自分が回復したか（薬草の音に使う） */
  healed: boolean;
  /** 自分が回復以外のものを使ったか */
  usedItem: boolean;
  /** 階層が変わったか */
  descended: boolean;
  /** 同じ音を2回鳴らさないための目印 */
  turn: number;
};

const EMPTY: TurnEffects = {
  effects: new Map(),
  ghosts: [],
  noticed: new Set(),
  selfHurt: false,
  anyHit: false,
  selfAttacked: false,
  picked: false,
  healed: false,
  usedItem: false,
  descended: false,
  turn: -1,
};

/** 残像を残す時間。CSS の die アニメーションと合わせる */
const GHOST_MS = 380;

function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export function useTurnEffects(state: GameState | null, myId: string | null): TurnEffects {
  const prevRef = useRef<GameState | null>(null);
  const [frame, setFrame] = useState<TurnEffects>(EMPTY);

  useEffect(() => {
    if (!state) return;

    const prev = prevRef.current;
    prevRef.current = state;

    // 同じターンの再配信（待ち状況の更新など）では何も起こさない
    if (!prev || prev.turn === state.turn) return;

    const before = new Map(prev.actors.map((a) => [a.id, a]));
    const effects = new Map<string, Effect>();
    const ghosts: Ghost[] = [];
    let selfHurt = false;

    const damaged: Actor[] = [];
    const stayed = new Set<string>();
    // 気づいていない → 気づいた に変わった敵。サーバーに報告させず差分で拾う
    const noticed = new Set<string>();

    for (const now of state.actors) {
      const was = before.get(now.id);
      if (!was) continue;

      if (was.pos.x !== now.pos.x || was.pos.y !== now.pos.y) {
        effects.set(now.id, {
          kind: 'moved',
          dx: now.pos.x - was.pos.x,
          dy: now.pos.y - was.pos.y,
        });
      } else {
        stayed.add(now.id);
      }

      if (now.kind === 'monster' && !was.aware && now.aware) noticed.add(now.id);

      if (now.hp < was.hp) {
        damaged.push(now);
        effects.set(now.id, { kind: 'hit' });
        if (now.id === myId) selfHurt = true;
      }
    }

    // 盤から消えた＝倒された
    for (const was of prev.actors) {
      if (state.actors.some((a) => a.id === was.id)) continue;
      ghosts.push({ id: was.id, sprite: speciesOf(was.speciesId).sprite, pos: was.pos });
    }

    // 攻撃の踏み込みを逆算する。
    // 「殴られた相手の隣にいて、このターン動かなかった敵対者」が殴った人。
    for (const target of damaged) {
      for (const other of state.actors) {
        if (other.id === target.id) continue;
        if (other.kind === target.kind) continue; // 仲間同士は殴らない
        if (!stayed.has(other.id)) continue;
        if (!isAdjacent(other.pos, target.pos)) continue;
        if (effects.get(other.id)?.kind === 'hit') continue; // 殴られた側を優先する
        effects.set(other.id, {
          kind: 'lunge',
          dx: target.pos.x - other.pos.x,
          dy: target.pos.y - other.pos.y,
        });
      }
    }

    const myItemsBefore = prev.items.filter((i) => i.ownerId === myId).length;
    const myItemsNow = state.items.filter((i) => i.ownerId === myId).length;

    const meBefore = prev.actors.find((a) => a.id === myId);
    const meNow = state.actors.find((a) => a.id === myId);
    const healed = meBefore !== undefined && meNow !== undefined && meNow.hp > meBefore.hp;
    // 拾ったわけではないのに持ち物が減った＝使った
    const usedItem = myItemsNow < myItemsBefore;

    setFrame({
      effects,
      ghosts,
      noticed,
      selfHurt,
      anyHit: damaged.length > 0,
      selfAttacked: effects.get(myId ?? "")?.kind === "lunge",
      picked: myItemsNow > myItemsBefore,
      healed,
      usedItem,
      descended: prev.floor.depth !== state.floor.depth,
      turn: state.turn,
    });

    if (ghosts.length === 0) return;
    const timer = setTimeout(
      () => setFrame((f) => (f.ghosts.length ? { ...f, ghosts: [] } : f)),
      GHOST_MS,
    );
    return () => clearTimeout(timer);
  }, [state, myId]);

  return frame;
}
