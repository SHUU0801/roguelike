import type { CSSProperties } from 'react';
import { ICON_INDEX, ICON_SHEET, type IconId } from '../shared/icons';
import {
  JOB_SHEET,
  POSE,
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
 * シートは 1職業1行・横に8ポーズ（src/shared/sprites.ts の POSE）。
 * ここで使うのは立ちの2枚（idle / idle2）だけで、
 * 入れ替えは CSS（.portrait）がやる。残りのポーズは戦闘画面用に取ってある。
 */
export function Portrait({ job, size = 128 }: { job: PortraitJob; size?: number }) {
  const { cols, rows, url } = PORTRAIT_SHEET;
  const at = (col: number) => `${-col * size}px`;

  return (
    <span
      className="portrait"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${url})`,
        backgroundSize: `${cols * size}px ${rows * size}px`,
        backgroundPosition: `${at(POSE.idle)} ${-PORTRAIT_ROW[job] * size}px`,
        // 呼吸の行き先。@keyframes がここへ横位置を動かす
        ['--pose-a' as string]: at(POSE.idle),
        ['--pose-b' as string]: at(POSE.idle2),
      }}
    />
  );
}

/**
 * 盤の上の姿を、一覧やボタンの中に出す。
 *
 * 立ち絵と同じ並びの小さいシート（jobs.png）から切り出す。
 * 仲間の顔や職業の選択に使う。**盤に出る姿と同じ絵**でないと、
 * 「この顔がダンジョンの中の誰なのか」が繋がらない。
 */
export function JobIcon({
  job,
  size = 32,
  pose = POSE.idle,
}: {
  job: PortraitJob;
  size?: number;
  pose?: number;
}) {
  const { cols, rows, url } = JOB_SHEET;
  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${url})`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${(pose / (cols - 1)) * 100}% ${
          (PORTRAIT_ROW[job] / (rows - 1)) * 100
        }%`,
      }}
    />
  );
}
