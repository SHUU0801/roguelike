import { roomAt, type Floor, type GameState, type Pos } from '../shared/types';

/**
 * 視界の処理。
 *
 * 方式は風来のシレン型:
 *   - 部屋の中にいる → その部屋全体と、部屋を囲む壁まで見える
 *   - 通路にいる     → 足元の8近傍だけ見える
 *
 * レイキャストや影の計算（shadowcasting）は使わない。
 * コードが短く、選んだジャンルの手触りにそのまま合い、
 * 「なぜここが見えるのか」を目で追える。
 *
 * floor.visible … 今見えているか。Actor とアイテムはここが true のマスにしか出さない
 * floor.seen    … 一度でも見たか。地形だけ記憶として残す
 */
export function updateVision(state: GameState): void {
  const { floor } = state;

  floor.visible = new Array<boolean>(floor.width * floor.height).fill(false);

  for (const actor of state.actors) {
    if (actor.kind !== 'player' || !actor.alive) continue;
    reveal(floor, actor.pos);
  }

  // 今見えたマスは「見たことがある」としても記録する
  for (let i = 0; i < floor.visible.length; i++) {
    if (floor.visible[i]) floor.seen[i] = true;
  }
}

function reveal(floor: Floor, pos: Pos): void {
  const room = roomAt(floor, pos.x, pos.y);

  if (room) {
    // 部屋の中 → 部屋全体 + 囲んでいる壁の縁（-1 / +w で1マス外まで）
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        setVisible(floor, x, y);
      }
    }
  }

  // 部屋にいても通路にいても、足元の8近傍は見える
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      setVisible(floor, pos.x + dx, pos.y + dy);
    }
  }
}

function setVisible(floor: Floor, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return;
  floor.visible[y * floor.width + x] = true;
}
