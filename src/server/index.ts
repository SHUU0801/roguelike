import { Server } from 'colyseus';
import { GameRoom } from './GameRoom';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server();

gameServer.define('game', GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[server] ポート ${PORT} で待機中`);
});
