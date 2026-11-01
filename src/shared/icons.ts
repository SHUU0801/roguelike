/**
 * UI のアイコン。
 *
 * 絵文字を使わない。見た目が揃わないからだけではなく、
 * **絵文字は端末ごとに絵が違う**（iPhone と Android と Windows で別物）ので、
 * 「この印は何か」を説明に書けない。自分で描けば、どこで開いても同じ絵になる。
 *
 * 画像は tools/make-sprites.mjs が生成する（`npm run sprites`）。
 * 並び順は ICON_LAYOUT と必ず一致させること。
 */

export const ICON_SHEET = {
  url: '/sprites/icons.png',
  tile: 16,
  cols: 8,
  rows: 4,
} as const;

export type IconId =
  | 'helmet'
  | 'dagger'
  | 'hat'
  | 'cross'
  | 'axe'
  | 'horn'
  | 'shield2'
  | 'smoke'
  | 'flask'
  | 'flame'
  | 'bolt'
  | 'ice'
  | 'sparkle'
  | 'note'
  | 'hammer'
  | 'heart'
  | 'sword2'
  | 'torch2'
  | 'wing'
  | 'star'
  | 'drop'
  | 'burst'
  | 'question'
  | 'map'
  | 'sound'
  | 'mute'
  | 'lock'
  | 'check'
  | 'skull';

export const ICON_INDEX: Record<IconId, number> = {
  helmet: 0,
  dagger: 1,
  hat: 2,
  cross: 3,
  axe: 4,
  horn: 5,
  shield2: 6,
  smoke: 7,
  flask: 8,
  flame: 9,
  bolt: 10,
  ice: 11,
  sparkle: 12,
  note: 13,
  hammer: 14,
  heart: 15,
  sword2: 16,
  torch2: 17,
  wing: 18,
  star: 19,
  drop: 20,
  burst: 21,
  question: 22,
  map: 23,
  sound: 24,
  mute: 25,
  lock: 26,
  check: 27,
  skull: 28,
};
