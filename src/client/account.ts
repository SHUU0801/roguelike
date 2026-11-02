import { applyDump, isEmptyDump, localDump, watchLocalChange, type Dump } from './carry';

/**
 * アカウント（画面側）。
 *
 * サーバー側の決まりは src/server/auth.ts と api.ts にある。
 * ここがするのは**合い言葉を預かって持ち歩くことだけ**で、
 * パスワードはサーバーへ渡したら手元に残さない。
 *
 * ## 合い言葉の置き場所
 *
 * localStorage に置く。Cookie にしないのは、サーバー側が
 * `Authorization` ヘッダで受けるようにしてあるため（CSRF を避けるため）。
 * 置き場所としての安全さは Cookie（httpOnly）のほうが上だが、
 * それは「このページの JavaScript から読めない」という話で、
 * **ページに悪いコードが入り込んだ時点でどちらも守れない。**
 * ここは外のスクリプトを読み込んでいないので、CSRF を避けるほうを取った。
 *
 * ## パスワードを忘れたら戻せない
 *
 * メールを送る手段が無いので、作者と相談のうえ**再設定は無い**。
 * 画面にもそう書く。黙っていると、忘れた人が問い合わせ先を探して
 * 見つからずに終わる。引き継ぎコードは保険として残してある。
 */

const TOKEN_KEY = 'roguelike:token';

/** まとめて上げるまでの待ち。1歩ごとに通信しないため */
const PUSH_WAIT = 2500;

export type Who = { login: string };

/**
 * やりとり先。
 *
 * 公開したときは画面と同じサーバーが `/api` も配っているので、
 * 開いている URL にそのまま投げればよい。
 * 開発中は Vite（5173）と サーバー（2567）が別なので、ポートを足す。
 * useGame.ts の serverUrl() と同じ考え方。片方だけ直すと食い違うので、
 * 直すときは両方見ること。
 */
function apiBase(): string {
  const override = import.meta.env.VITE_SERVER_URL;
  // WebSocket 用の指定が入っていることがあるので、http に直す
  if (override) return override.replace(/^ws/, 'http');
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:2567`;
  }
  return window.location.origin;
}

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function keepToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 覚えられなくても、このまま開いている間は遊べる
  }
}

export function signedIn(): boolean {
  return loadToken() !== '';
}

/**
 * サーバーに投げる。
 *
 * 失敗を例外にしない。**通信は普通に失敗する**ので、
 * 例外にすると呼ぶ側が毎回 try で囲むことになり、囲み忘れた場所で画面が落ちる。
 */
type Reply<T> = { ok: true; body: T } | { ok: false; message: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<Reply<T>> {
  const token = loadToken();
  try {
    const res = await fetch(`${apiBase()}/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // サーバーが落ちていると HTML が返ってくることがある
    }
    if (!res.ok) {
      const said =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>).error
          : undefined;
      return { ok: false, message: typeof said === 'string' ? said : `つながらない（${res.status}）` };
    }
    return { ok: true, body: body as T };
  } catch {
    return { ok: false, message: 'サーバーにつながらない' };
  }
}

type AuthBody = { token: string; login: string; save: string };

/* ── 入る・作る・出る ───────────────────────────── */

export type SignInResult =
  | { ok: true; login: string; /** アカウント側に別の記録があった */ conflict: Dump | null }
  | { ok: false; message: string };

/**
 * 新しく作る。
 *
 * **いまこの端末にある記録を一緒に上げる。** そうしないと、
 * しばらく遊んでから登録した人が倉庫を失う。
 * 登録した瞬間に手持ちが消える作りは、誰も登録しなくなる。
 */
export async function register(login: string, password: string): Promise<SignInResult> {
  const r = await call<AuthBody>('/register', {
    method: 'POST',
    body: JSON.stringify({ login, password, save: JSON.stringify(localDump()) }),
  });
  if (!r.ok) return r;
  keepToken(r.body.token);
  return { ok: true, login: r.body.login, conflict: null };
}

/**
 * 入る。
 *
 * ## 2つの記録がぶつかったとき
 *
 * アカウントにも記録があり、この端末にも記録がある、という場面が普通に起きる。
 * **どちらかを黙って消してはいけない。** 消したほうが
 * 何十回も潜った記録だったときに取り返せない。
 * ぶつかったら `conflict` に相手の中身を入れて返し、選ばせる（SignIn.tsx）。
 *
 * ぶつかっていない場合だけ自動で進める：
 * - アカウント側が空なら、この端末のものを上げる
 * - この端末が空なら、アカウントのものを書き戻す
 */
export async function signIn(login: string, password: string): Promise<SignInResult> {
  const r = await call<AuthBody>('/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  if (!r.ok) return r;
  keepToken(r.body.token);

  const mine = localDump();
  const theirs = parseDump(r.body.save);

  if (isEmptyDump(theirs)) {
    if (!isEmptyDump(mine)) await pushNow();
    return { ok: true, login: r.body.login, conflict: null };
  }
  if (isEmptyDump(mine) || sameDump(mine, theirs)) {
    applyDump(theirs);
    return { ok: true, login: r.body.login, conflict: null };
  }
  return { ok: true, login: r.body.login, conflict: theirs };
}

/** ぶつかったときの選択。アカウント側を取る */
export function takeAccountSide(dump: Dump): void {
  applyDump(dump);
}

/** ぶつかったときの選択。この端末を取る（アカウント側を上書きする） */
export async function takeDeviceSide(): Promise<void> {
  await pushNow();
}

export async function signOut(): Promise<void> {
  await call('/logout', { method: 'POST' });
  keepToken('');
  /*
   * **この端末の記録は消さない。** 出たら手元も空になる作りだと、
   * 「別のアカウントを試したら元の記録が消えた」が起きる。
   * アカウント側には上げ終わっているので、残しておいて害がない。
   */
}

/** いま誰で入っているか。合い言葉が切れていたら捨てて null */
export async function whoAmI(): Promise<Who | null> {
  if (!signedIn()) return null;
  const r = await call<{ login: string; save: string }>('/me');
  if (!r.ok) {
    // つながらないだけなら合い言葉は捨てない。切れていると言われたときだけ
    if (r.message === '入り直してから') keepToken('');
    return null;
  }
  return { login: r.body.login };
}

export async function changePassword(
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await call<AuthBody>('/password', {
    method: 'POST',
    body: JSON.stringify({ current, next }),
  });
  if (!r.ok) return r;
  // 変えると他の端末の合い言葉は切れる。この端末の新しいものを受け取る
  keepToken(r.body.token);
  return { ok: true };
}

/* ── 自動で上げる ──────────────────────────────── */

let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
/** 送っている間に次の変更が来たか */
let again = false;

/** いま手元にあるものを上げる。入っていなければ何もしない */
export async function pushNow(): Promise<void> {
  if (!signedIn()) return;
  if (sending) {
    again = true;
    return;
  }
  sending = true;
  try {
    await call('/save', {
      method: 'POST',
      body: JSON.stringify({ save: JSON.stringify(localDump()) }),
    });
  } finally {
    sending = false;
  }
  if (again) {
    again = false;
    await pushNow();
  }
}

/**
 * 記録が変わったら、少し待ってまとめて上げる。
 *
 * 待たずに上げると、1回潜る間に何十回も通信する。
 * 待っている間に閉じられた場合は上げ損なうので、
 * 閉じる直前（`pagehide`）にもう一度試す。
 */
export function startSync(): () => void {
  const stop = watchLocalChange(() => {
    if (!signedIn()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void pushNow();
    }, PUSH_WAIT);
  });

  const onHide = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    void pushNow();
  };
  window.addEventListener('pagehide', onHide);

  return () => {
    stop();
    window.removeEventListener('pagehide', onHide);
    if (timer) clearTimeout(timer);
  };
}

/* ── 中身を見る ───────────────────────────────── */

function parseDump(save: string): Dump {
  if (!save) return {};
  try {
    const o: unknown = JSON.parse(save);
    if (typeof o !== 'object' || o === null) return {};
    const out: Dump = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 同じ中身なら選ばせる必要がない。鍵と値をそのまま比べる */
function sameDump(a: Dump, b: Dump): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  return ak.every((k, i) => bk[i] === k && a[k] === b[k]);
}

/**
 * ぶつかった記録を一言で表す。
 *
 * 「アカウントの記録」と言われても選べない。
 * **何回潜ったか・何階まで行ったか・倉庫に何個あるか**が分かれば選べる。
 */
export function describeDump(dump: Dump): string {
  const parts: string[] = [];
  try {
    const p: unknown = JSON.parse(dump['roguelike:profile'] ?? '{}');
    if (typeof p === 'object' && p !== null) {
      const o = p as { name?: unknown; runs?: unknown; deepest?: unknown };
      /*
       * 名前を先に出す。数字がどちらも 0 のとき——作ったばかりで
       * 名前だけ付けたアカウントがこれ——他に見分けるものが無い。
       */
      if (typeof o.name === 'string' && o.name) parts.push(o.name);
      if (typeof o.runs === 'number' && o.runs > 0) parts.push(`${o.runs}回もぐった`);
      if (typeof o.deepest === 'number' && o.deepest > 0) parts.push(`B${o.deepest}F まで`);
    }
  } catch {
    // 読めない記録でも、他の項目は出す
  }
  try {
    const s: unknown = JSON.parse(dump['roguelike:stash'] ?? '[]');
    // 0個は言わない。「倉庫 0個」だけが出ると、何も無いのに記録があるように見える
    if (Array.isArray(s) && s.length > 0) parts.push(`倉庫 ${s.length}個`);
  } catch {
    // 同上
  }
  return parts.length > 0 ? parts.join('・') : '記録あり';
}
