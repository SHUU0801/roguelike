import type { Dir } from '../shared/types';

type Props = {
  onMove: (dir: Dir) => void;
  onWait: () => void;
  disabled: boolean;
  /** 持ち物やわざの一覧が開いている間は出さない */
  hidden: boolean;
};

/**
 * 画面左下の十字ボタン。
 *
 * 盤のマスを直接タップする操作は残してある（遠くを見ながら動かせるので速い）。
 * ただしそれだけだと、スマホでは**親指が盤を隠す**うえに、
 * 行きたいマスが指1本ぶんしかなく、隣のマスを押してしまう。
 * 歩くだけの操作に、場所の決まった大きいボタンが要る。
 *
 * 盤の上に重ねて出すのは、縦に場所が無いから。
 * 375×667 では盤とログとボタン列で画面が埋まっていて、
 * 十字ボタンのぶんの行を足すと下が画面の外に出る。
 * 半透明にして、触っていない間は盤が透けるようにしてある。
 */
export function DPad({ onMove, onWait, disabled, hidden }: Props) {
  /*
   * 一覧が開いている間は引っ込める。
   *
   * 重ねて出す以上、下に何が来るかで必ず衝突する。実機で持ち物を開いたら
   * 「薬草」の字が十字ボタンの裏に隠れた。幅や余白で避けようとすると、
   * 一覧の行が増えるたびに同じ調整をやり直すことになる。
   * 持ち物を見ている間は歩かないので、消すのが素直。
   */
  if (hidden) return null;

  const key = (dir: Dir, label: string) => (
    <button
      className="dpad-btn"
      disabled={disabled}
      aria-label={label}
      onClick={() => onMove(dir)}
    >
      {label}
    </button>
  );

  return (
    <div className="dpad" aria-hidden={disabled}>
      <span />
      {key('n', '↑')}
      <span />
      {key('w', '←')}
      {/* 真ん中は待機。十字の中心が空いていると押し間違いの受け皿になる */}
      <button
        className="dpad-btn dpad-wait"
        disabled={disabled}
        aria-label="待機"
        onClick={onWait}
      >
        ・
      </button>
      {key('e', '→')}
      <span />
      {key('s', '↓')}
      <span />
    </div>
  );
}
