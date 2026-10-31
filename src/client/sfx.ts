/**
 * 効果音。
 *
 * **音のファイルを1つも使わない。** Web Audio でその場で合成する。
 * 素材のダウンロードもライセンスの管理も要らず、全部で数 KB しかない。
 *
 * ブラウザは「ユーザーが何か操作するまで音を鳴らしてはいけない」という決まりなので、
 * AudioContext は最初に音を鳴らそうとしたときに作る。
 * 最初のタップが操作にあたるので、それ以降は普通に鳴る。
 */

const STORAGE_KEY = 'roguelike:muted';

let ctx: AudioContext | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // 使えなくても音の切り替えはできる
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // 音が出せない環境でもゲームは動く
  }
}

type ToneOptions = {
  from: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
};

/** 単音。周波数を from から to へ滑らせる */
function tone({ from, to, dur, type = 'square', gain = 0.06, delay = 0 }: ToneOptions): void {
  const ac = audio();
  if (!ac) return;

  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);

  // 立ち上がりを一瞬つけないと「プツッ」と鳴る
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** ノイズ。打撃音の「バシッ」の部分 */
function noise(dur: number, gain = 0.07, cutoff = 1800): void {
  const ac = audio();
  if (!ac) return;

  const t = ac.currentTime;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(t);
}

export const sfx = {
  /** 自分が殴った */
  attack(): void {
    tone({ from: 320, to: 140, dur: 0.09, type: 'square', gain: 0.05 });
    noise(0.06, 0.05, 2600);
  },

  /** 誰かが殴られた */
  hit(): void {
    noise(0.09, 0.08, 1200);
    tone({ from: 180, to: 90, dur: 0.1, type: 'triangle', gain: 0.05 });
  },

  /** 自分が殴られた。低くて嫌な音にする */
  hurt(): void {
    noise(0.14, 0.1, 700);
    tone({ from: 150, to: 60, dur: 0.18, type: 'sawtooth', gain: 0.07 });
  },

  /** 敵を倒した */
  kill(): void {
    tone({ from: 420, to: 70, dur: 0.26, type: 'sawtooth', gain: 0.06 });
    noise(0.12, 0.05, 900);
  },

  /** 拾った。軽く2音上がる */
  pickup(): void {
    tone({ from: 620, dur: 0.06, type: 'sine', gain: 0.05 });
    tone({ from: 930, dur: 0.08, type: 'sine', gain: 0.05, delay: 0.06 });
  },

  /** 薬草を飲んだ。ごくりと飲んでから、柔らかく上がる */
  heal(): void {
    tone({ from: 220, to: 330, dur: 0.1, type: 'sine', gain: 0.05 });
    tone({ from: 523, dur: 0.1, type: 'sine', gain: 0.05, delay: 0.09 });
    tone({ from: 784, dur: 0.16, type: 'sine', gain: 0.045, delay: 0.17 });
  },

  /** 回復以外のものを使った（剣・盾・松明・巻物） */
  use(): void {
    tone({ from: 440, to: 660, dur: 0.12, type: 'triangle', gain: 0.05 });
  },

  /** 階段を降りた */
  descend(): void {
    tone({ from: 300, to: 110, dur: 0.4, type: 'sine', gain: 0.07 });
  },

  /** クリア */
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ from: f, dur: 0.16, type: 'triangle', gain: 0.06, delay: i * 0.11 }),
    );
  },

  /** 全滅 */
  lose(): void {
    [392, 330, 262, 196].forEach((f, i) =>
      tone({ from: f, dur: 0.3, type: 'sawtooth', gain: 0.06, delay: i * 0.16 }),
    );
  },
};
