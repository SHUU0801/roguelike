import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'colyseus';
import express from 'express';
import { GameRoom } from './GameRoom';
import { mountApi } from './api';
import { memoryStore, postgresStore, type Store } from './store';

/**
 * サーバーの起動。
 *
 * **公開するときは、このサーバー1つで画面も配信する。**
 * 画面を別のサービス（Cloudflare Pages など）に置くと、公開先が2つになり、
 * CORS と2つの URL の管理が増える。1つにまとめれば、
 * ブラウザが開いている URL にそのまま WebSocket で繋げばよくなる。
 *
 * 開発中は Vite（5173）が画面を配信し、こちらは WebSocket だけを受け持つ。
 * dist/ が無ければ静的配信はしないので、開発中の動きは変わらない。
 */

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? '0.0.0.0';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
const hasBuild = existsSync(join(dist, 'index.html'));

/*
 * アカウントの保管庫。
 *
 * `DATABASE_URL` があれば Postgres、無ければその場限りの記憶。
 * **本番で記憶のほうに落ちたら起動を止める。** 黙って動くと、
 * 再起動のたびに全員のアカウントが消えるのに誰も気づかない。
 */
const dbUrl = process.env.DATABASE_URL;
let store: Store;
if (dbUrl) {
  store = await postgresStore(dbUrl);
} else if (hasBuild && process.env.ALLOW_MEMORY_STORE !== '1') {
  /*
   * dist/ があるのに保管先が無い＝公開モードで記憶に落ちかけている。
   * **黙って動かさない。** 再起動のたびに全員のアカウントが消えるのに、
   * 誰も気づかないまま運用されるのが一番まずい。
   *
   * 手元で `npm run preview` を試したいときは ALLOW_MEMORY_STORE=1 を付ける。
   * 付けるのは手元だけ。公開先に置いてはいけない。
   */
  console.error('[server] DATABASE_URL が無い。公開モードでは起動しない');
  console.error('[server] アカウントが再起動のたびに消えるため');
  console.error('[server] Render なら Blueprint を再同期すると');
  console.error('[server]   render.yaml の roguelike-db が立って自動で入る');
  console.error('[server] 手元で試すだけなら ALLOW_MEMORY_STORE=1 を付ける');
  process.exit(1);
} else {
  if (hasBuild) {
    console.warn('[server] ⚠ 記憶だけで動いている。再起動でアカウントは消える');
  } else {
    console.log('[server] DATABASE_URL が無いので、その場限りの記憶を使う（開発モード）');
  }
  store = memoryStore();
}
await store.ready();

const gameServer = new Server({
  express: (app) => {
    // アカウントの口は、画面の配信より先に登録する（後だと index.html に奪われる）
    mountApi(app, store);

    if (!hasBuild) return;

    app.use(express.static(dist));

    // 画面は1ページしかないので、知らない URL は index.html に返す。
    // Colyseus 自身のルート（/matchmake など）はこの前に登録済みなので奪わない。
    app.get(/.*/, (_req, res) => {
      res.sendFile(join(dist, 'index.html'));
    });
  },
});

gameServer.define('game', GameRoom);

gameServer.listen(PORT, HOST).then(() => {
  console.log(`[server] ${HOST}:${PORT} で待機中`);
  console.log(
    hasBuild
      ? '[server] dist/ を配信する（公開モード）'
      : '[server] dist/ が無いので WebSocket のみ（開発モード）',
  );
});
