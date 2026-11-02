/**
 * 動きの計算。**描画から切り離してある。**
 *
 * ## なぜ切り出したか
 *
 * 3D の盤は毎コマ `requestAnimationFrame` で描いている。
 * ところが確認に使っているブラウザのペインが隠れていると、
 * **rAF がそもそも呼ばれない。** 画面は最後に描いたコマのまま止まる。
 *
 * それに気づかず「ループが死んでいる」と思い込んで、
 * 直す必要のないところを3回書き直した。計測のほうが壊れていた。
 *
 * 動きの中身がここにあれば、描画を動かさずに
 * 「0.16 秒の時点で半分進んでいて、足は2コマ目」を試験で確かめられる。
 * 目で見るのは最後の仕上げだけでよくなる。
 */

export type MotionKind = 'moved' | 'lunge' | 'hit' | 'die';

/** それぞれの動きの長さ（秒）。2D 版（CSS）と揃えてある */
export const DURATION: Record<MotionKind, number> = {
  moved: 0.32,
  lunge: 0.3,
  hit: 0.36,
  die: 0.45,
};

export type Motion = {
  /** マス何個ぶんずらすか */
  dx: number;
  dz: number;
  /** 持ち上げる高さ */
  dy: number;
  /** 歩きのコマ。0 か 1 */
  step: 0 | 1;
  /** 不透明度の倍率 */
  fade: number;
  /** 白飛びの強さ */
  glow: number;
  /** 倒れるときの回転 */
  spin: number;
  /** 動き終わったか */
  done: boolean;
};

const STILL: Motion = { dx: 0, dz: 0, dy: 0, step: 0, fade: 1, glow: 0, spin: 0, done: true };

/**
 * 動きの途中の姿を求める。
 *
 * `t` は 0〜1 に正規化した進み具合。1 を超えたら「終わった」を返す。
 * dx / dy は進んだ向き（-1 / 0 / 1）。
 */
export function motionAt(kind: MotionKind, t: number, dx: number, dy: number): Motion {
  if (t >= 1) return STILL;
  const m: Motion = { dx: 0, dz: 0, dy: 0, step: 0, fade: 1, glow: 0, spin: 0, done: false };

  switch (kind) {
    case 'moved': {
      // 元いた方向から滑り込む。t=0 で1マス後ろ、t=1 で到着
      const back = 1 - t;
      m.dx = -dx * back;
      m.dz = -dy * back;
      /*
       * 足。1歩のあいだに2回踏み替える。
       * 滑らせるだけだと「進んでいる」ではなく「滑っている」に見える。
       */
      m.step = (Math.floor(t * 4) % 2) as 0 | 1;
      // ほんの少し上下させて足音を感じさせる。跳ねて見えない程度に
      m.dy = Math.abs(Math.sin(t * Math.PI * 2)) * 0.06;
      break;
    }
    case 'lunge': {
      // 行って帰る。山なりにすると「突いた」感じになる
      const out = Math.sin(t * Math.PI) * 0.4;
      m.dx = dx * out;
      m.dz = dy * out;
      break;
    }
    case 'hit': {
      m.dx = Math.sin(t * Math.PI * 6) * 0.12;
      m.glow = Math.max(0, 0.9 - t * 3); // 一瞬だけ白く飛ばす
      break;
    }
    case 'die': {
      // 回って沈んで消える
      m.dy = -t * 0.5;
      m.spin = t * 1.2;
      m.fade = 1 - t;
      break;
    }
  }
  return m;
}
