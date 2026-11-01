import { ITEMS, type ItemId } from '../shared/items';
import type { DungeonId } from '../shared/dungeons';

/**
 * 倉庫と記録。ブラウザに貯める。
 *
 * ## なぜブラウザなのか
 *
 * サーバーに保存先が無い（データベースを持っていない）。
 * アカウントも無いので、誰の持ち物かを識別する手段もない。
 *
 * **つまり自己申告で、その気になれば増やせる。**
 * 友達と遊ぶ範囲では困らないので今はこれでいく。
 * 知らない人と遊ぶ日が来たら、ここと GameRoom の 'loadout' を
 * サーバー側の保存に差し替える（07_ホームと周回.md §5）。
 *
 * ## 何を貯めるか
 *
 *   stash   踏破して持ち帰ったアイテム。次に潜るとき持ち込める
 *   cleared 踏破したダンジョン。次のダンジョンの解放に使う
 *
 * 死ぬと袋の中身は失われる。持ち帰れるのは**踏破したときだけ**。
 * これが「もう1階だけ潜るか、ここで引き返すか」を作っている。
 */

const STASH_KEY = 'roguelike:stash';
const CLEARED_KEY = 'roguelike:cleared';

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // プライベートモードでは読めない。読めなくても遊べる
    return [];
  }
}

function write(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 覚えられなくても遊べる
  }
}

export function loadStash(): ItemId[] {
  return read(STASH_KEY).filter((v): v is ItemId => v in ITEMS);
}

export function saveStash(items: ItemId[]): void {
  // 無限に貯まると持ち込み画面が読めなくなる。古いものから捨てる
  write(STASH_KEY, items.slice(-40));
}

/** 踏破して持ち帰る。倉庫に足す */
export function bringHome(items: ItemId[]): void {
  if (items.length === 0) return;
  saveStash([...loadStash(), ...items]);
}

/** 持ち込んだぶんを倉庫から減らす。二重に使えないようにする */
export function spendFromStash(taken: ItemId[]): void {
  const left = loadStash();
  for (const id of taken) {
    const i = left.indexOf(id);
    if (i >= 0) left.splice(i, 1);
  }
  saveStash(left);
}

export function loadCleared(): DungeonId[] {
  return read(CLEARED_KEY) as DungeonId[];
}

export function markCleared(id: DungeonId): void {
  const now = loadCleared();
  if (now.includes(id)) return;
  write(CLEARED_KEY, [...now, id]);
}
