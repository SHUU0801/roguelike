import type { CSSProperties } from 'react';
import { ICON_INDEX, ICON_SHEET, type IconId } from '../shared/icons';
import {
  PORTRAIT_ROW,
  PORTRAIT_SHEET,
  SHEET,
  SPRITE_INDEX,
  type SpriteId,
} from '../shared/sprites';

/** 立ち絵のある職業。盤のスプライトとは別の並びなので型も別に持つ */
export type PortraitJob = keyof typeof PORTRAIT_ROW;

/** 16 の倍数だけ。端数だと 1 ドットが間引かれてつぶれる */
export type IconSize = 16 | 32 | 48 | 64 | 80 | 96;

type Props = {
  id: IconId;
  /**
   * 何ピクセル角で出すか。**16 の倍数だけにすること。**
   *
   * 絵は 16x16 なので、15px や 24px にすると 1 ドットが 0.94 倍・1.5 倍になり、
   * 行や列が間引かれてつぶれる。image-rendering: pixelated は
   * ぼかさないだけで、端数を直してはくれない。
   * 実際ヘッダーを 15px で出したら、どのアイコンも読めなかった。
   */
  size?: IconSize;
};

/**
 * 描いたアイコンを1枚切り出して出す。
 *
 * 盤面のスプライトと同じやり方（% で切り出して image-rendering: pixelated）。
 * ピクセル計算にしないのは、大きさを変えても付いてくるようにするため。
 */
export function iconStyle(id: IconId, size: number): CSSProperties {
  const index = ICON_INDEX[id];
  const col = index % ICON_SHEET.cols;
  const row = Math.floor(index / ICON_SHEET.cols);

  return {
    width: size,
    height: size,
    backgroundImage: `url(${ICON_SHEET.url})`,
    backgroundSize: `${ICON_SHEET.cols * 100}% ${ICON_SHEET.rows * 100}%`,
    backgroundPosition: `${(col / (ICON_SHEET.cols - 1)) * 100}% ${
      (row / (ICON_SHEET.rows - 1)) * 100
    }%`,
  };
}

export function Icon({ id, size = 16 }: Props) {
  return <span className="icon" style={iconStyle(id, size)} />;
}

/**
 * 盤面のスプライトを一覧に出す。
 *
 * 持ち物の薬草と、盤に落ちている薬草が別の絵だと、
 * 「床にあるこれが持ち物のこれ」が繋がらない。同じ絵を使う。
 */
export function TileIcon({ id, size = 32 }: { id: SpriteId; size?: IconSize }) {
  const index = SPRITE_INDEX[id];
  const col = index % SHEET.cols;
  const row = Math.floor(index / SHEET.cols);

  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${SHEET.url})`,
        backgroundSize: `${SHEET.cols * 100}% ${SHEET.rows * 100}%`,
        backgroundPosition: `${(col / (SHEET.cols - 1)) * 100}% ${
          (row / (SHEET.rows - 1)) * 100
        }%`,
      }}
    />
  );
}

/**
 * ホーム画面の立ち絵。
 *
 * 盤のスプライトと違い、**ピクセル指定で切り出す。**
 * 盤は % 指定（大きさを変えても付いてくる）だが、立ち絵は
 * コマ送りで横へ1枠ずらすので、枠の幅がそのままピクセルで要る。
 *
 * 呼吸は CSS（.portrait）がやる。ここは1コマ目を置くだけ。
 */
export function Portrait({ job, size = 128 }: { job: PortraitJob; size?: number }) {
  const { tile, cols, rows, url } = PORTRAIT_SHEET;
  const scale = size / tile;

  return (
    <span
      className="portrait"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${url})`,
        backgroundSize: `${cols * size}px ${rows * size}px`,
        backgroundPosition: `0px ${-PORTRAIT_ROW[job] * size}px`,
        // コマ送りの幅。CSS の @keyframes がこれだけ横へずらす
        ['--frame' as string]: `${-size}px`,
        ['--portrait-scale' as string]: scale,
      }}
    />
  );
}
