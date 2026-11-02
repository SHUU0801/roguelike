/**
 * アカウントの保管庫。
 *
 * ## なぜ外に置くのか
 *
 * Render の無料枠は**ディスクが揮発する。** 再起動や再公開のたびに消えるので、
 * SQLite をファイルで置いても意味がない。外の Postgres に置くしかない。
 * render.yaml が無料の Postgres を一緒に立てて、
 * `DATABASE_URL` を自動で渡してくれる。
 *
 * ## 2つの実装がある
 *
 * `DATABASE_URL` があれば Postgres、無ければ**その場限りの記憶**。
 * 記憶のほうは開発と試験のためのもので、プロセスが死ねば消える。
 * 本番で記憶のほうに落ちると全員のデータが消えるので、
 * **本番では無いと起動時に止める**（index.ts）。黙って動かすほうが危ない。
 *
 * ## 無料の Postgres の限界（作者と共有済み）
 *
 * Render の無料 Postgres は**一定期間で消える。**
 * 消えたらアカウントも全部消える。長く続けるなら、
 * 有料にするか Neon などに移すこと。移すのは `DATABASE_URL` の差し替えだけ。
 */

export type Account = {
  id: string;
  /** ログイン名。英数と一部記号。表示名とは別物 */
  login: string;
  /** scrypt の結果（auth.ts の形式） */
  password: string;
  /** 続けて外した回数。成功で 0 に戻す */
  failures: number;
  /** 最後に外した時刻（ミリ秒） */
  lastFailAt: number;
  /** ゲームの持ち物。中身はクライアントが決める（profile / stash の JSON） */
  save: string;
  createdAt: number;
};

export type Session = {
  /** 合い言葉の要約。生の値は保管しない */
  digest: string;
  accountId: string;
  expiresAt: number;
};

export interface Store {
  /** 使えるようにする。表が無ければ作る */
  ready(): Promise<void>;
  findByLogin(login: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  create(a: Account): Promise<void>;
  /** 外した回数や保存データの更新 */
  update(id: string, patch: Partial<Account>): Promise<void>;
  putSession(s: Session): Promise<void>;
  findSession(digest: string): Promise<Session | null>;
  dropSession(digest: string): Promise<void>;
  /** その人の合い言葉を全部無効にする。パスワードを変えたときに使う */
  dropSessionsOf(accountId: string): Promise<void>;
}

/* ── その場限り（開発と試験用） ───────────────────── */

export function memoryStore(): Store {
  const accounts = new Map<string, Account>();
  const byLogin = new Map<string, string>();
  const sessions = new Map<string, Session>();

  return {
    async ready() {},
    async findByLogin(login) {
      const id = byLogin.get(login.toLowerCase());
      return id ? (accounts.get(id) ?? null) : null;
    },
    async findById(id) {
      return accounts.get(id) ?? null;
    },
    async create(a) {
      accounts.set(a.id, { ...a });
      byLogin.set(a.login.toLowerCase(), a.id);
    },
    async update(id, patch) {
      const a = accounts.get(id);
      if (a) accounts.set(id, { ...a, ...patch });
    },
    async putSession(s) {
      sessions.set(s.digest, { ...s });
    },
    async findSession(digest) {
      return sessions.get(digest) ?? null;
    },
    async dropSession(digest) {
      sessions.delete(digest);
    },
    async dropSessionsOf(accountId) {
      for (const [d, s] of sessions) if (s.accountId === accountId) sessions.delete(d);
    },
  };
}

/* ── Postgres ───────────────────────────────────── */

/**
 * Postgres の実装。
 *
 * `pg` だけは外のものに頼る。接続プール・SSL・型変換を自前で書く意味がない。
 * **問い合わせは必ずプレースホルダ（$1）で渡す。**
 * 文字列を繋いで組み立てると SQL を差し込まれる。
 */
export async function postgresStore(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    // Render の Postgres は SSL だが、証明書の鎖が内部のものなので検証は切る
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
    max: 4,
  });

  const q = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values);

  return {
    async ready() {
      await q(`
        CREATE TABLE IF NOT EXISTS accounts (
          id           TEXT PRIMARY KEY,
          login        TEXT NOT NULL,
          password     TEXT NOT NULL,
          failures     INTEGER NOT NULL DEFAULT 0,
          last_fail_at BIGINT  NOT NULL DEFAULT 0,
          save         TEXT    NOT NULL DEFAULT '',
          created_at   BIGINT  NOT NULL
        )`);
      /*
       * 同じ名前を2つ作らせない。**アプリ側の確認だけでは足りない。**
       * 同時に2人が同じ名前で登録を押すと、どちらも「空いている」と
       * 判断して両方入ってしまう。最後の砦は索引に持たせる。
       */
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_login_key
               ON accounts (LOWER(login))`);
      await q(`
        CREATE TABLE IF NOT EXISTS sessions (
          digest     TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          expires_at BIGINT NOT NULL
        )`);
    },

    async findByLogin(login) {
      const r = await q<Row>('SELECT * FROM accounts WHERE LOWER(login) = LOWER($1)', [login]);
      return r.rows[0] ? toAccount(r.rows[0]) : null;
    },
    async findById(id) {
      const r = await q<Row>('SELECT * FROM accounts WHERE id = $1', [id]);
      return r.rows[0] ? toAccount(r.rows[0]) : null;
    },
    async create(a) {
      await q(
        `INSERT INTO accounts (id, login, password, failures, last_fail_at, save, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.id, a.login, a.password, a.failures, a.lastFailAt, a.save, a.createdAt],
      );
    },
    async update(id, patch) {
      const cols: string[] = [];
      const vals: unknown[] = [];
      const put = (col: string, v: unknown) => {
        vals.push(v);
        cols.push(`${col} = $${vals.length}`);
      };
      if (patch.password !== undefined) put('password', patch.password);
      if (patch.failures !== undefined) put('failures', patch.failures);
      if (patch.lastFailAt !== undefined) put('last_fail_at', patch.lastFailAt);
      if (patch.save !== undefined) put('save', patch.save);
      if (cols.length === 0) return;
      vals.push(id);
      await q(`UPDATE accounts SET ${cols.join(', ')} WHERE id = $${vals.length}`, vals);
    },

    async putSession(s) {
      await q(
        `INSERT INTO sessions (digest, account_id, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (digest) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [s.digest, s.accountId, s.expiresAt],
      );
    },
    async findSession(digest) {
      const r = await q<{ digest: string; account_id: string; expires_at: string }>(
        'SELECT * FROM sessions WHERE digest = $1',
        [digest],
      );
      const row = r.rows[0];
      return row
        ? { digest: row.digest, accountId: row.account_id, expiresAt: Number(row.expires_at) }
        : null;
    },
    async dropSession(digest) {
      await q('DELETE FROM sessions WHERE digest = $1', [digest]);
    },
    async dropSessionsOf(accountId) {
      await q('DELETE FROM sessions WHERE account_id = $1', [accountId]);
    },
  };
}

type Row = {
  id: string;
  login: string;
  password: string;
  failures: number;
  last_fail_at: string;
  save: string;
  created_at: string;
};

/** BIGINT は文字列で返ってくる。数に直す */
function toAccount(r: Row): Account {
  return {
    id: r.id,
    login: r.login,
    password: r.password,
    failures: r.failures,
    lastFailAt: Number(r.last_fail_at),
    save: r.save,
    createdAt: Number(r.created_at),
  };
}
