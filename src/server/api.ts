import type { Application, Request, Response } from 'express';
import express from 'express';
import { makeAccounts } from './accounts';
import type { Store } from './store';

/**
 * アカウントのやりとり口（HTTP）。
 *
 * ゲーム本体は WebSocket（Colyseus）だが、ログインは**入る前**の話なので
 * 部屋に入らなくても使える HTTP にしてある。
 *
 * ## 合い言葉の渡し方
 *
 * `Authorization: Bearer <合い言葉>` で受ける。Cookie にしないのは、
 * Cookie だと**他所のページから勝手に送られる**（CSRF）ので、
 * その対策を自前で足すことになるため。
 * ヘッダなら、こちらの画面の JavaScript が明示的に付けたものしか届かない。
 *
 * ## 返すもの
 *
 * 失敗はすべて `{ error: string }`。日本語でそのまま画面に出せる文言にする。
 * **どこで失敗したかは詳しく書かない**（accounts.ts の方針のまま）。
 */

/** 送られてくる JSON の上限。大きな本文で詰まらせるのを防ぐ */
const BODY_LIMIT = '32kb';

/** 保存できる持ち物の大きさ。倉庫40個＋記録でこれを超えることはない */
const SAVE_LIMIT = 16 * 1024;

function tokenOf(req: Request): string {
  const h = req.header('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** 文字列として受け取れたものだけ返す。数や配列が来ても落ちないように */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/*
 * Colyseus が渡してくるのは `Application`（`Express` ではない）。
 * 型を合わせるために広いほうで受ける。使う機能は同じ。
 */
export function mountApi(app: Application, store: Store): void {
  const accounts = makeAccounts(store);
  app.use('/api', express.json({ limit: BODY_LIMIT }));

  const fail = (res: Response, code: number, message: string) =>
    res.status(code).json({ error: message });

  app.post('/api/register', async (req, res) => {
    const r = await accounts.register(
      str(req.body?.login),
      str(req.body?.password),
      str(req.body?.save).slice(0, SAVE_LIMIT),
    );
    if (!r.ok) return fail(res, 400, r.message);
    res.json({ token: r.token, login: r.login, save: r.save });
  });

  app.post('/api/login', async (req, res) => {
    const r = await accounts.login(str(req.body?.login), str(req.body?.password));
    // 401 を返す。失敗の理由は文言に出さない（accounts.ts の方針）
    if (!r.ok) return fail(res, 401, r.message);
    res.json({ token: r.token, login: r.login, save: r.save });
  });

  app.post('/api/logout', async (req, res) => {
    await accounts.logout(tokenOf(req));
    res.json({ ok: true });
  });

  /** いま誰で入っているか。画面を開いたときに確かめる */
  app.get('/api/me', async (req, res) => {
    const who = await accounts.whoIs(tokenOf(req));
    if (!who) return fail(res, 401, '入り直してから');
    res.json({ login: who.login, save: who.save });
  });

  app.post('/api/save', async (req, res) => {
    const save = str(req.body?.save);
    if (save.length > SAVE_LIMIT) return fail(res, 413, '保存するものが大きすぎる');
    const done = await accounts.save(tokenOf(req), save);
    if (!done) return fail(res, 401, '入り直してから');
    res.json({ ok: true });
  });

  app.post('/api/password', async (req, res) => {
    const r = await accounts.changePassword(
      tokenOf(req),
      str(req.body?.current),
      str(req.body?.next),
    );
    if (!r.ok) return fail(res, 400, r.message);
    res.json({ token: r.token, login: r.login, save: r.save });
  });
}
