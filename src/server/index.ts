import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'colyseus';
import express from 'express';
import { GameRoom } from './GameRoom';

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

const gameServer = new Server({
  express: (app) => {
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
