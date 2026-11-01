/**
 * ユーザーデータ。キャラ（職業）とは別の、遊ぶ人そのものの記録。
 *
 * ## これは本物のアカウントではない
 *
 * サーバーに保存先が無く、パスワードも検証していない。
 * **ブラウザのデータを消すと無くなる。** 別の端末にも自動では移らない。
 *
 * その代わり「引き継ぎコード」を用意した（§ exportCode）。
 * コードを書き写せば別の端末へ移せる。
 * 日本のスマホゲームでよくある「データ引き継ぎ」と同じ考え方で、
 * サーバーを持たずにできる範囲ではこれが上限。
 *
 * 本物のアカウントにするなら、直す場所は
 * このファイルと GameRoom の 'loadout' / 'name' の2か所だけに閉じてある。
 *
 * ## ユーザーレベルは何を測るか
 *
 * キャラのレベル（潜るたびに1から）とは別。**遊んだ量**を測る。
 * 潜って深く行けば増え、踏破すればまとまって増える。死んでも減らない。
 * 「今日は遺跡だけ回して終わり」でも何か残るようにするため。
 */

const KEY = 'roguelike:profile';

export type Profile = {
  name: string;
  /** 遊んだ量。ユーザーレベルの素 */
  exp: number;
  /** 潜った回数 */
  runs: number;
  /** 踏破した回数 */
  clears: number;
  /** 一番深く行った階 */
  deepest: number;
};

const EMPTY: Profile = { name: '', exp: 0, runs: 0, clears: 0, deepest: 0 };

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p: unknown = JSON.parse(raw);
    if (typeof p !== 'object' || p === null) return { ...EMPTY };
    const o = p as Partial<Profile>;
    return {
      name: typeof o.name === 'string' ? o.name.slice(0, 12) : '',
      exp: typeof o.exp === 'number' ? o.exp : 0,
      runs: typeof o.runs === 'number' ? o.runs : 0,
      clears: typeof o.clears === 'number' ? o.clears : 0,
      deepest: typeof o.deepest === 'number' ? o.deepest : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても遊べる
  }
}

export function setName(name: string): void {
  saveProfile({ ...loadProfile(), name: name.slice(0, 12) });
}

/**
 * 1回の潜行が終わったときの記録。
 *
 * 深さそのものを経験にする。踏破すると上乗せ。
 * 死んでも深さぶんは残るので、挑んだこと自体が無駄にならない。
 */
export function recordRun(depth: number, cleared: boolean): void {
  const p = loadProfile();
  saveProfile({
    ...p,
    exp: p.exp + depth * 10 + (cleared ? 50 : 0),
    runs: p.runs + 1,
    clears: p.clears + (cleared ? 1 : 0),
    deepest: Math.max(p.deepest, depth),
  });
}

/**
 * ユーザーレベル。
 *
 * 必要量を少しずつ増やす。キャラのレベル（上限10）と違って上限は置かない。
 * 遊んだ量の目印であって、強さではないので、上限があると止まるだけ損。
 */
export function userLevel(exp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = exp;
  let need = 100;
  while (left >= need) {
    left -= need;
    level += 1;
    need = 100 + (level - 1) * 40;
  }
  return { level, into: left, need };
}

/**
 * 引き継ぎコード。
 *
 * 倉庫・踏破・覚えたわざ・ユーザーデータをまとめて1つの文字列にする。
 * サーバーを持たずに別の端末へ移す唯一の手段。
 * 中身はただの JSON なので、書き換えれば何でも持てる——
 * ここは §「本物のアカウントではない」のとおり。
 */
const CARRY_KEYS = [
  'roguelike:profile',
  'roguelike:stash',
  'roguelike:cleared',
  'roguelike:skills',
] as const;

export function exportCode(): string {
  const dump: Record<string, string> = {};
  for (const key of CARRY_KEYS) {
    const v = localStorage.getItem(key);
    if (v !== null) dump[key] = v;
  }
  // 日本語は入らない（中身は id と数字だけ）ので btoa で足りる
  return btoa(unescape(encodeURIComponent(JSON.stringify(dump))));
}

/** 引き継ぎコードを読む。読めなければ false */
export function importCode(code: string): boolean {
  try {
    const json: unknown = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (typeof json !== 'object' || json === null) return false;

    const dump = json as Record<string, unknown>;
    // 知っている鍵だけ書き戻す。知らない鍵は無視する
    let wrote = 0;
    for (const key of CARRY_KEYS) {
      const v = dump[key];
      if (typeof v !== 'string') continue;
      localStorage.setItem(key, v);
      wrote++;
    }
    return wrote > 0;
  } catch {
    return false;
  }
}
