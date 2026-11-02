import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * パスワードの保管と検証。**ここだけは思いつきで書かない。**
 *
 * ## なぜ自前で書いているか
 *
 * 外のサービス（Supabase など）に任せるほうが安全だと伝えたうえで、
 * 作者が「自前で」と決めた。決定なので実装する。
 * ただし**暗号そのものは自作しない。** Node 標準の scrypt を使う。
 * 自作するのはパラメータの選び方と、比較の仕方だけ。
 *
 * ## 守っていること
 *
 * 1. **生のパスワードは保存も記録もしない。** 残るのは scrypt の結果だけ
 * 2. **塩は利用者ごとに乱数。** 同じパスワードでも保管される値が違う。
 *    これが無いと、1つ破られたら同じパスワードの人が全員破られる
 * 3. **比較は timingSafeEqual。** `===` だと、何文字目で外れたかが
 *    応答時間に出る。1文字ずつ総当たりできてしまう
 * 4. **パラメータを保管する値に書き込む。** `scrypt$N$r$p$塩$結果` の形。
 *    計算機が速くなって N を上げたいとき、古い利用者を弾かずに移行できる
 *
 * ## 守れていないこと（作者と共有済み）
 *
 * **パスワードを忘れたら復旧できない。** メールを送る手段が無いため。
 * これは方式の選択そのものから来る限界で、実装では埋められない。
 * 引き継ぎコード（profile.ts）を保険として残してある。
 */

/*
 * scrypt の重さ。
 *
 * N はメモリと時間の両方を食う。大きいほど総当たりが高くつくが、
 * **こちらのサーバーも同じだけ払う。** Render の無料枠は CPU が弱く、
 * 2^15 だと1回 300ms を超えてログインが詰まった。2^14 に落としてある。
 * 速い機械へ移したら上げること（保管形式に N が入っているので移行できる）。
 */
const N = 16384; // 2^14
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
/** scrypt は N*r*128 バイト使う。既定の上限（32MB）では足りないので明示する */
const MAXMEM = 64 * 1024 * 1024;

/** パスワードの最低限。短すぎるものは受け付けない */
export const MIN_PASSWORD = 8;
/** 長すぎる入力で計算量を食わせる攻撃を防ぐ */
export const MAX_PASSWORD = 200;

/** 利用者名の決まり。英数と一部記号だけ。表示名とは別物 */
const NAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

export function isValidLoginName(name: string): boolean {
  return NAME_RE.test(name);
}

/** 受け付けられるパスワードか。理由つきで返す */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `パスワードは${MIN_PASSWORD}文字以上`;
  if (pw.length > MAX_PASSWORD) return 'パスワードが長すぎる';
  return null;
}

/**
 * パスワードを保管する形にする。
 * 戻り値は `scrypt$N$r$p$塩$結果`（どれも base64url）。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * 保管してある値と突き合わせる。
 *
 * **パラメータは保管値から読む。** 定数を使うと、N を変えた瞬間に
 * 既存の利用者が全員ログインできなくなる。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // 壊れた値で巨大な計算をさせられないように上限を置く
  if (n > 1 << 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const key = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  });

  // 長さが違うと timingSafeEqual が例外を投げる。先に見ておく
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/* ── 合い言葉（セッション） ───────────────────────── */

/** 1つの合い言葉が効く長さ。切れたら入り直す */
export const SESSION_DAYS = 60;

/**
 * 合い言葉を作る。
 *
 * 32 バイトの乱数。推測できる余地を残さない。
 * 返すのは利用者に渡す生の値で、**保管するのはその要約（SHA-256）。**
 */
export function newSessionToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, digest: digestToken(token) };
}

/**
 * 合い言葉を保管する形にする。
 *
 * **生のまま保管しない。** 保管庫が漏れたとき、生の合い言葉が入っていると
 * そのまま全員になりすませる。要約だけなら、漏れても使えない。
 *
 * パスワードと違って scrypt を使わないのは、合い言葉が 32 バイトの乱数で
 * 総当たりの余地が無いから。毎回の通信で重い計算をするほうが害になる。
 */
export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/* ── 総当たり対策 ─────────────────────────────── */

/**
 * 続けて外した回数から、次に試せるようになるまでの待ち時間（ミリ秒）。
 *
 * 伸ばし方は倍々。5回目で 8 秒、10回目で 4 分ほど。
 * 完全に締め出さないのは、他人がわざと外して本人を閉め出せてしまうため。
 */
export function lockoutMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(15 * 60 * 1000, 1000 * 2 ** (failures - 3));
}
