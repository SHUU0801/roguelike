import { JOBS, JOB_IDS } from '../shared/jobs';
import { MAX_DEPTH, TURN_LIMIT_MS } from '../shared/types';

type Props = { onClose: () => void };

/** 初回だけ自動で開くための目印。2回目からは自分で開く */
const SEEN_KEY = 'roguelike:howto-seen';

export function howToSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // プライベートモードでは読めない。読めないときは「まだ見ていない」でいい
    return false;
  }
}

export function markHowToSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 覚えられなくても遊べる
  }
}

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
            地下 {MAX_DEPTH} 階まで降りれば踏破。全員が倒れると終わり。
            階段は誰か1人が乗ったうえで、<b>全員が「降りる」を押す</b>と進む。
          </p>

          <h3>動かす</h3>
          <ul>
            <li>画面左下の十字ボタン。真ん中は待機</li>
            <li>盤のマスを直接タップしてもいい</li>
            <li>PC は矢印キー / <code>.</code> 待機 / <code>g</code> 拾う / <code>m</code> 地図</li>
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
            🔥 の数字は毎ターン1ずつ減る。<b>消えると毎ターン傷ついていく。</b>
            だから「安全な通路で粘る」が答えにならない。
            松明は落ちているので拾って継ぎ足す。
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
                    {job.glyph} {job.name}
                  </b>
                  — {job.tagline}
                  <br />
                  <span className="dim-text">
                    {job.skill.name}（{job.skill.cooldown}ターンに1回）: {job.skill.desc}
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
