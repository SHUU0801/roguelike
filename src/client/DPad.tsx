import type { Dir } from '../shared/types';

type Props = {
  onMove: (dir: Dir) => void;
  onWait: () => void;
  disabled: boolean;
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
export function DPad({ onMove, onWait, disabled }: Props) {
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
