import type { DungeonId } from '../shared/dungeons';
import { ITEMS, type ItemId } from '../shared/items';
import type { JobId } from '../shared/jobs';
import { SKILLS, type SkillId } from '../shared/skills';

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
const SKILLS_KEY = 'roguelike:skills';

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

/**
 * 覚えたわざの記録。職業ごとに貯める。
 *
 * わざは潜るたびにレベル1から覚え直すので、そのままだと持ち越すものが無い。
 * **一度でも覚えたわざは記録して、次の潜行で1つ持ち込める**ことにした。
 * 倉庫と同じ理屈で周回に乗る。
 *
 * 記録は踏破したときだけ（倒れたら残らない）。倉庫と同じ約束にして、
 * 「持ち帰るには踏破が要る」を1つの決まりにまとめている。
 */
export function loadLearned(): Partial<Record<JobId, SkillId[]>> {
  try {
    const raw = localStorage.getItem(SKILLS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Partial<Record<JobId, SkillId[]>>;
  } catch {
    return {};
  }
}

export function learnedOf(job: JobId): SkillId[] {
  return (loadLearned()[job] ?? []).filter((v): v is SkillId => v in SKILLS);
}

/** 踏破したときに、その周で覚えたわざを記録する */
export function rememberSkills(job: JobId, skills: SkillId[]): void {
  const all = loadLearned();
  const now = new Set([...(all[job] ?? []), ...skills]);
  try {
    localStorage.setItem(SKILLS_KEY, JSON.stringify({ ...all, [job]: [...now] }));
  } catch {
    // 覚えられなくても遊べる
  }
}
