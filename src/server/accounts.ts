import { randomUUID } from 'node:crypto';
import {
  SESSION_DAYS,
  digestToken,
  hashPassword,
  isValidLoginName,
  lockoutMs,
  newSessionToken,
  passwordProblem,
  verifyPassword,
} from './auth';
import type { Store } from './store';

/**
 * アカウントの出し入れ。
 *
 * ## 言ってはいけないこと
 *
 * **「その名前は無い」と「パスワードが違う」を区別して返さない。**
 * 区別すると、名前だけを総当たりして**誰が登録しているかを調べられる。**
 * どちらも同じ「名前かパスワードが違う」で返す。
 *
 * 登録のときだけは「その名前は使われている」と言う必要がある。
 * 言わないと登録しようがないため。ここは避けられない引き換え。
 *
 * ## 返す形
 *
 * 失敗は例外ではなく `{ ok: false, message }` で返す。
 * 例外にすると、どこかで握りつぶしたときに**成功として素通りする**。
 * 成否を値で持てば、呼ぶ側が見落とせない。
 */

export type AuthResult =
  | { ok: true; token: string; login: string; save: string }
  | { ok: false; message: string };

/** 名前かパスワードが違うときの文言。**どちらが違うかは言わない** */
const WRONG = '名前かパスワードが違う';

export function makeAccounts(store: Store) {
  const issue = async (accountId: string, login: string, save: string): Promise<AuthResult> => {
    const { token, digest } = newSessionToken();
    await store.putSession({
      digest,
      accountId,
      expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
    return { ok: true, token, login, save };
  };

  return {
    async register(login: string, password: string, save: string): Promise<AuthResult> {
      if (!isValidLoginName(login)) {
        return { ok: false, message: '名前は英数字と _ . - で3〜20文字' };
      }
      const bad = passwordProblem(password);
      if (bad) return { ok: false, message: bad };

      if (await store.findByLogin(login)) {
        return { ok: false, message: 'その名前は使われている' };
      }

      const account = {
        id: randomUUID(),
        login,
        password: await hashPassword(password),
        failures: 0,
        lastFailAt: 0,
        save,
        createdAt: Date.now(),
      };
      try {
        await store.create(account);
      } catch {
        /*
         * 索引が弾いた＝同時に同じ名前で登録された。
         * 上の findByLogin では間に合わない瞬間がある（両方が「空いている」と見る）。
         */
        return { ok: false, message: 'その名前は使われている' };
      }
      return issue(account.id, account.login, save);
    },

    async login(login: string, password: string): Promise<AuthResult> {
      const account = await store.findByLogin(login);

      /*
       * 名前が無いときも、**パスワードの計算をしてから**返す。
       * すぐ返すと、応答の速さで「その名前は無い」と分かってしまう。
       * 偽の保管値に対して同じ重さの計算を走らせて、時間を揃える。
       */
      if (!account) {
        await verifyPassword(password, DECOY);
        return { ok: false, message: WRONG };
      }

      const wait = lockoutMs(account.failures) - (Date.now() - account.lastFailAt);
      if (wait > 0) {
        return { ok: false, message: `続けて間違えたので ${Math.ceil(wait / 1000)} 秒待つ` };
      }

      if (!(await verifyPassword(password, account.password))) {
        await store.update(account.id, {
          failures: account.failures + 1,
          lastFailAt: Date.now(),
        });
        return { ok: false, message: WRONG };
      }

      if (account.failures !== 0) await store.update(account.id, { failures: 0, lastFailAt: 0 });
      return issue(account.id, account.login, account.save);
    },

    /** 合い言葉から持ち主を引く。切れていたら捨てる */
    async whoIs(token: string): Promise<{ id: string; login: string; save: string } | null> {
      if (!token) return null;
      const digest = digestToken(token);
      const s = await store.findSession(digest);
      if (!s) return null;
      if (s.expiresAt < Date.now()) {
        await store.dropSession(digest);
        return null;
      }
      const a = await store.findById(s.accountId);
      return a ? { id: a.id, login: a.login, save: a.save } : null;
    },

    async logout(token: string): Promise<void> {
      if (token) await store.dropSession(digestToken(token));
    },

    /** ゲームの持ち物を保存する。中身はクライアントが決める */
    async save(token: string, save: string): Promise<boolean> {
      const who = await this.whoIs(token);
      if (!who) return false;
      await store.update(who.id, { save });
      return true;
    },

    async changePassword(token: string, current: string, next: string): Promise<AuthResult> {
      const who = await this.whoIs(token);
      if (!who) return { ok: false, message: '入り直してから' };

      const bad = passwordProblem(next);
      if (bad) return { ok: false, message: bad };

      const account = await store.findById(who.id);
      if (!account || !(await verifyPassword(current, account.password))) {
        return { ok: false, message: 'いまのパスワードが違う' };
      }

      await store.update(who.id, { password: await hashPassword(next) });
      /*
       * **他の端末の合い言葉を全部切る。**
       * パスワードを変える理由はたいてい「誰かに知られた」なので、
       * 変えても古い合い言葉が生きていては意味がない。
       */
      await store.dropSessionsOf(who.id);
      return issue(who.id, who.login, account.save);
    },
  };
}

/**
 * 名前が無いときに時間を揃えるための偽物。
 * 中身は何でもいいが、**本物と同じ重さ**でなければ意味がない。
 */
const DECOY =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
