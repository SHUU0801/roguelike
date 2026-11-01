import { JOBS, JOB_IDS } from '../shared/jobs';
import { BASE_SKILL, SKILLS } from '../shared/skills';
import { Icon } from './Icon';
import { TURN_LIMIT_MS } from '../shared/types';

type Props = { onClose: () => void };

/*
 * 初回に自動で開くのをやめた。
 *
 * 起動していきなり長い文章が出ても読まれないし、読んでも盤の前では忘れている。
 * 覚えてもらう役は、やって覚えるチュートリアル（Tutorial.tsx）に渡した。
 * ここは**後から調べ直すための手控え**として、潜行中の歯車の中に残す。
 */

/**
 * あそびかた。
 *
 * 1F の最初の部屋に薬草と弱い敵を置く仕掛け（段階B）は、
 * 「歩く・拾う・殴る」を体で覚えさせるためのもの。
 * ただしそれだけだと**ターン制であること**と**松明が減ること**が伝わらない。
 * この2つは画面を見ても分からないので、文章で先に言う必要がある。
 */
export function HowTo({ onClose }: Props) {
  return (
    <div className="map-overlay" onClick={onClose}>
      <div className="howto" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>あそびかた</b>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="howto-body">
          <h3>目的</h3>
          <p>
            {/* 階数はダンジョンごとに違う（遺跡 3・洞窟 5・氷 7）。
                ここに数字を書くと、どれに潜っていても同じ数字が出てしまう */}
            一番下の階まで降りれば踏破。何階まであるかはダンジョンの札に出ている。
            全員が倒れると終わり。
            階段は誰か1人が乗ったうえで、<b>全員が「降りる」を押す</b>と進む。
          </p>

          <h3>動かす</h3>
          <ul>
            <li>画面左下の十字ボタン。真ん中は待機</li>
            <li>盤のマスを直接タップしてもいい</li>
            <li>
              PC は矢印キー / <code>.</code> 待機 / <code>g</code> 拾う /{' '}
              <code>s</code> わざ / <code>m</code> 地図
            </li>
            <li>敵のいるマスへ進むと攻撃になる（ボタンは無い）</li>
          </ul>

          <h3>ターン制</h3>
          <p>
            <b>全員の行動が揃うとゲームが1手進む。</b>
            自分が動いても、仲間が決めるまで盤面は止まったまま。
            誰かが止まっても {Math.round(TURN_LIMIT_MS / 1000)} 秒で勝手に進むので、
            放置した人がいても詰まらない。
          </p>

          <h3>松明が時間の値段</h3>
          <p>
            <Icon id="torch2" size={16} /> の数字は毎ターン1ずつ減る。
            <b>消えると毎ターン傷ついていく。</b>
            だから「安全な通路で粘る」が答えにならない。
            松明は落ちているので拾って継ぎ足す。
          </p>

          <h3>敵の向きを見る</h3>
          <p>
            敵のマスには、向いている方向に小さな三角が出る。
            <b>灰色はまだ気づいていない</b>、赤は気づいている。
            気づいていない敵を殴ると<b>2倍のダメージ</b>が入り、
            そのターンは殴り返されない。
            視野は正面の45度・4マスだけなので、<b>横から回り込める</b>。
          </p>

          <h3>倒れても終わりではない</h3>
          <p>
            倒れた人も<b>歩ける</b>。攻撃と取得はできないが、視界は仲間と共有なので
            偵察役になれる。隣にいる仲間が「起こす」を押すと復活する
            （起こした人の最大体力が減る）。
          </p>

          <h3>レベルと強化カード</h3>
          <p>
            敵を倒すと<b>パーティ全員</b>に経験値が入る。とどめを誰が刺しても同じ。
            レベルが上がると<b>3枚のカードから1枚</b>選んで強くなる。
            選ばなかった2枚は消える。
          </p>

          <h3>職業</h3>
          <ul className="howto-jobs">
            {JOB_IDS.map((id) => {
              const job = JOBS[id];
              return (
                <li key={id}>
                  <b>
                    <Icon id={job.icon} size={16} /> {job.name}
                  </b>
                  — {job.tagline}
                  <br />
                  <span className="dim-text">
                    {SKILLS[BASE_SKILL[id]].name}（
                    {SKILLS[BASE_SKILL[id]].cooldown}ターンに1回）:{' '}
                    {SKILLS[BASE_SKILL[id]].desc}
                  </span>
                </li>
              );
            })}
          </ul>

          <h3>仲間に物を渡す</h3>
          <p>
            「持ち物」から<b>置く</b>と足元に落ちる。それを仲間が拾う。
            持ち物の画面では仲間の持ち物も見られるので、
            「薬草が誰にも無い」が分かる。
          </p>
        </div>

        <button className="wide primary" onClick={onClose}>
          わかった
        </button>
      </div>
    </div>
  );
}
