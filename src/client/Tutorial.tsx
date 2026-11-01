import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconId } from '../shared/icons';
import type { Actor, GameState } from '../shared/types';

/**
 * やって覚えるチュートリアル。
 *
 * ## なぜ文章をやめたか
 *
 * 前は「あそびかた」の長い文章を最初に出していた。
 * **読まれない。** 読んでも、盤の前に戻ったときには忘れている。
 * 指を動かして覚えたことしか残らないので、
 * 固定の階（server/dungeon.ts の createTutorialFloor）を1つ用意して、
 * 部屋ごとに1つずつやらせる形にした。
 *
 * ## 進み方はサーバーに持たない
 *
 * 「いま何歩目か」は `GameState` を見れば分かる——
 * 敵が生きているか、薬草を持っているか、剣を持っているか。
 * だから**サーバーは何も覚えない。** ここが覚えるのは
 * 「一度進んだら戻らない」ことだけ（`reached`）。
 *
 * 戻さないのは、たとえば薬草を使うと「持っている」が false に戻るから。
 * 条件だけで決めると、使った瞬間に「薬草を拾え」に巻き戻る。
 */

type Step = {
  icon: IconId;
  /** やること。1行。ここで仕組みの説明はしない */
  text: string;
  done: (state: GameState, me: Actor) => boolean;
};

const STEPS: Step[] = [
  {
    icon: 'map',
    text: '十字ボタンで、右の部屋へ行こう',
    // 部屋を分ける壁は x=6。そこを越えたら歩けたということ
    done: (_state, me) => me.pos.x > 6,
  },
  {
    icon: 'dagger',
    text: 'コウモリにぶつかると攻撃になる',
    done: (state) => !state.actors.some((a) => a.kind === 'monster' && a.alive),
  },
  {
    icon: 'flask',
    text: '下の部屋へ降りよう。薬草は乗れば拾える',
    done: (state, me) => carries(state, me, 'potion'),
  },
  {
    icon: 'heart',
    text: '「持ち物」から薬草を選んで使ってみよう',
    // 1つ前で拾わせているので、無くなった＝使った
    done: (state, me) => !carries(state, me, 'potion'),
  },
  {
    icon: 'sword2',
    text: '左の部屋へ。剣は持っているだけで攻撃が上がる',
    done: (state, me) => carries(state, me, 'sword'),
  },
  {
    icon: 'check',
    text: '階段に乗って「降りる」。これで終わり',
    // 最後。踏破したら画面ごと切り替わるので、ここが done になることはない
    done: () => false,
  },
];

function carries(state: GameState, me: Actor, itemId: string): boolean {
  return state.items.some((i) => i.ownerId === me.id && i.itemId === itemId);
}

type Props = {
  state: GameState;
  me: Actor;
};

export function TutorialGuide({ state, me }: Props) {
  const reached = useRef(0);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let i = reached.current;
    // 順番に見ていって、済んでいるものを飛ばす。前には戻さない
    while (i < STEPS.length && STEPS[i].done(state, me)) i++;
    if (i !== reached.current) {
      reached.current = i;
      setAt(i);
    }
  }, [state, me]);

  const step = STEPS[Math.min(at, STEPS.length - 1)];

  return (
    <div className="tutorial-step">
      <Icon id={step.icon} size={16} />
      <span className="tutorial-text">{step.text}</span>
      {/* 残りが見えないと、いつ終わるのか分からない */}
      <span className="tutorial-count">
        {Math.min(at + 1, STEPS.length)}/{STEPS.length}
      </span>
    </div>
  );
}
