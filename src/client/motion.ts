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

/**
 * 殴り方。2D 版（CSS の slam / bite / squish）と同じ3種類。
 *
 * 全部同じ動きだと、何に殴られたのかが動きから分からない。
 * ゴブリンは体当たり、コウモリは二度噛み、スライムは潰れて伸びる。
 */
export type Swing = 'slam' | 'bite' | 'squish';

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
  /**
   * コマ番号。0 か 1。
   *   歩き  … 踏み出した足を入れ替える
   *   殴り  … 0 が振りかぶり、1 が振り抜き
   */
  step: 0 | 1;
  /** 不透明度の倍率 */
  fade: number;
  /** 白飛びの強さ */
  glow: number;
  /** 倒れるときの回転 */
  spin: number;
  /** 潰れ具合。スライムだけ使う */
  sx: number;
  sy: number;
  /** 動き終わったか */
  done: boolean;
};

const STILL: Motion = { dx: 0, dz: 0, dy: 0, step: 0, fade: 1, glow: 0, spin: 0, sx: 1, sy: 1, done: true };

/**
 * 動きの途中の姿を求める。
 *
 * `t` は 0〜1 に正規化した進み具合。1 を超えたら「終わった」を返す。
 * dx / dy は進んだ向き（-1 / 0 / 1）。
 */
export function motionAt(
  kind: MotionKind,
  t: number,
  dx: number,
  dy: number,
  swing: Swing = 'slam',
): Motion {
  if (t >= 1) return STILL;
  const m: Motion = { dx: 0, dz: 0, dy: 0, step: 0, fade: 1, glow: 0, spin: 0, sx: 1, sy: 1, done: false };

  switch (kind) {
    case 'moved': {
      // 元いた方向から滑り込む。t=0 で1マス後ろ、t=1 で到着
      const back = 1 - t;
      m.dx = -dx * back;
      m.dz = -dy * back;
      /*
       * 足。**1マスにつき1回だけ踏み替える。**
       *
       * 最初は 0.32 秒のあいだに4回入れ替えていた。
       * 秒間 12 コマで足だけが細かく震えることになり、
       * 歩きではなく痙攣に見えた（「ぎこちない」の正体のひとつ）。
       * 1マス＝1歩なのだから、踏み替えも1回でいい。
       */
      m.step = (t < 0.5 ? 0 : 1) as 0 | 1;
      /*
       * 上下。**足と位相を合わせる。**
       * 踏み出した瞬間に沈み、着くころに戻る。
       * 足の入れ替えと別の周期で揺れていると、体と足がばらばらに動く。
       */
      m.dy = Math.sin(t * Math.PI) * 0.05;
      break;
    }
    case 'lunge': {
      /*
       * 剣を振る。
       *
       * 最初は sin の山なりで行って帰るだけにしていたが、
       * **0.3 秒ずっと同じ絵**なので振っているように見えなかった。
       *
       * 2D 版（CSS の slam）と同じ形にする:
       *   25% で少し引く（振りかぶり）
       *   55% で大きく出る（振り抜き）
       *   100% で戻る
       * 引いてから出すと、同じ距離でも打撃に見える。
       */
      let out: number;
      if (swing === 'bite') {
        // 二度噛み。速く2回出る。コウモリの羽ばたきに合う
        const jab = (u: number) => (u < 0.5 ? u / 0.5 : (1 - u) / 0.5);
        out = jab(t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5) * 0.42;
      } else if (swing === 'squish') {
        // 潰れてから伸びて体当たり
        out = t < 0.3 ? 0 : ((t - 0.3) / 0.7) * 0.46 * (1 - (t - 0.3) / 0.7) * 4;
        m.sx = t < 0.3 ? 1 + (t / 0.3) * 0.25 : 1.25 - ((t - 0.3) / 0.7) * 0.45;
        m.sy = t < 0.3 ? 1 - (t / 0.3) * 0.28 : 0.72 + ((t - 0.3) / 0.7) * 0.5;
      } else {
        out =
          t < 0.25 ? (t / 0.25) * -0.22
          : t < 0.55 ? -0.22 + ((t - 0.25) / 0.3) * 0.74
          : 0.52 * (1 - (t - 0.55) / 0.45);
      }
      m.dx = dx * out;
      m.dz = dy * out;
      // 引いている間は構えの絵、出てからは斬る絵
      m.step = t < 0.28 ? 0 : 1;
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

/* ── わざの演出 ────────────────────────────────────── */

/**
 * わざの見た目。2D 版（CSS の .fx-*）と同じ3種類に分ける。
 *
 *   slash … 斜めの筋が走る（斬る系）
 *   burst … 中心から焼ける（飛び道具系）
 *   ring  … 輪が広がる（支援系）
 *
 * わざ12種類ぶんの絵は作らない。**形3つ×色**で足りる。
 * 大事なのは「何が起きたか」が1秒で分かることで、絵の種類数ではない。
 */
export type FxShape = 'slash' | 'burst' | 'ring';

export type FxLook = { shape: FxShape; color: number; life: number };

export const FX: Record<string, FxLook> = {
  cleave: { shape: 'slash', color: 0xffffff, life: 0.34 },
  backstab: { shape: 'slash', color: 0xffffff, life: 0.34 },
  smite: { shape: 'slash', color: 0xffffff, life: 0.34 },
  fireball: { shape: 'burst', color: 0xe8c84a, life: 0.38 },
  bolt: { shape: 'burst', color: 0xe8c84a, life: 0.38 },
  frost: { shape: 'burst', color: 0xc8f0ff, life: 0.42 },
  venom: { shape: 'burst', color: 0xaa78e6, life: 0.42 },
  vanish: { shape: 'burst', color: 0xc8ced6, life: 0.5 },
  heal: { shape: 'ring', color: 0x79d19a, life: 0.5 },
  bless: { shape: 'ring', color: 0x79d19a, life: 0.5 },
  taunt: { shape: 'ring', color: 0xe0c060, life: 0.5 },
  bulwark: { shape: 'ring', color: 0xe0c060, life: 0.5 },
};

/** わざの演出の、その瞬間の大きさと濃さ */
export function fxAt(shape: FxShape, t: number): { scale: number; fade: number; spin: number } {
  if (t >= 1) return { scale: 1, fade: 0, spin: 0 };
  switch (shape) {
    case 'slash':
      // 小さく現れて、振り抜けながら消える
      return {
        scale: 0.6 + t * 0.7,
        fade: t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7,
        spin: (-20 + t * 30) * (Math.PI / 180),
      };
    case 'ring':
      // 輪が広がって薄れる
      return { scale: 0.3 + t * 1.3, fade: 0.9 * (1 - t), spin: 0 };
    default:
      // 点いてすぐ消える
      return { scale: 1, fade: t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75, spin: 0 };
  }
}
