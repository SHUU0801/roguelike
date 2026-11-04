import { useEffect, useState } from 'react';

/**
 * 締め切りまでの残り秒。待っていないときは null。
 *
 * 締め切りそのものはサーバーが決めた時刻（epoch ミリ秒）で、
 * ここがするのは**それを数えて見せることだけ**。
 * 画面側で時間を計って行動を打ち切ったりはしない——
 * 端末の時計がずれていたら、人によって持ち時間が変わってしまう。
 *
 * 0.25 秒ごとに描き直す。1秒ごとだと、表示が変わる瞬間が実際より
 * 最大1秒遅れて「まだ2秒あるのに切れた」に見える。
 */
export function useSecondsLeft(deadlineAt: number | null): number | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (deadlineAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  if (deadlineAt === null) return null;
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}
