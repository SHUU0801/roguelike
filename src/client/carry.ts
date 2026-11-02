/**
 * この端末に溜まっている記録をひとまとめにする。
 *
 * ## なぜ分けたか
 *
 * 記録の移し方が2つになった。引き継ぎコード（profile.ts）と
 * アカウント（account.ts）。どちらも**同じものを運ぶ**ので、
 * 「何を運ぶか」の一覧が2か所にあると必ず片方が古くなる。
 * 鍵の一覧はここだけに置く。
 *
 * ## 変わったことを知らせる
 *
 * ログインしている間は、記録が変わるたびにサーバーへ上げたい。
 * ただし**書き込むたびに通信しては多すぎる**（1歩ごとに倉庫が動く場面がある）。
 * ここでは「変わった」と言うだけにして、まとめ方は聞く側（account.ts）に任せる。
 */

/**
 * 運ぶ鍵。
 *
 * 知らない鍵は運ばない。増やすときはここに足す。
 * `tutorial-done` も入れる。入れないと、別の端末で開いたときに
 * もう終えたチュートリアルをまた勧められる。
 */
export const CARRY_KEYS = [
  'roguelike:profile',
  'roguelike:stash',
  'roguelike:cleared',
  'roguelike:skills',
  'roguelike:tutorial-done',
] as const;

export type Dump = Record<string, string>;

/** いまこの端末にあるものを集める。無い鍵は入れない */
export function localDump(): Dump {
  const dump: Dump = {};
  for (const key of CARRY_KEYS) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) dump[key] = v;
    } catch {
      // プライベートモードでは読めない。読めたものだけ運ぶ
    }
  }
  return dump;
}

/** 何も遊んでいない端末か。アカウントの記録で上書きしてよいかの判断に使う */
export function isEmptyDump(dump: Dump): boolean {
  return Object.keys(dump).length === 0;
}

/**
 * 書き戻す。書けた鍵の数を返す。
 *
 * **知っている鍵だけ**書く。知らない鍵を書くと、
 * 作った覚えのない値がこの端末に残る。
 */
export function applyDump(dump: unknown): number {
  if (typeof dump !== 'object' || dump === null) return 0;
  const o = dump as Record<string, unknown>;
  let wrote = 0;
  for (const key of CARRY_KEYS) {
    const v = o[key];
    if (typeof v !== 'string') continue;
    try {
      localStorage.setItem(key, v);
      wrote++;
    } catch {
      // 書けなくても他の鍵は試す
    }
  }
  return wrote;
}

/* ── 変わったことを知らせる ─────────────────────── */

const watchers = new Set<() => void>();

/** 記録が変わったら呼ぶ。保存する側（stash.ts / profile.ts）から */
export function noteLocalChange(): void {
  for (const fn of watchers) {
    try {
      fn();
    } catch {
      // 聞く側がしくじっても、ゲームは続ける
    }
  }
}

/** 変わったことを聞く。戻り値を呼ぶと聞くのをやめる */
export function watchLocalChange(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
