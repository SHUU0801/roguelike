import { useEffect, useState } from 'react';
import { JOBS, JOB_IDS, jobOf, type JobId } from '../shared/jobs';
import { MAX_PLAYERS, type GameState } from '../shared/types';
import { HowTo, howToSeen, markHowToSeen } from './HowTo';

type Props = {
  state: GameState;
  myId: string;
  inviteUrl: string;
  onStart: () => void;
  onChooseJob: (job: JobId) => void;
};

/**
 * 最初に出るメニュー画面。
 *
 * 以前は「ダンジョンへ」という見出しと URL 入力欄と開始ボタンだけで、
 * 何のゲームか分からないまま唐突に潜らされていた。ここで
 * **何をする遊びか / 自分は何者か / 操作はどうするか**の3つを先に見せる。
 *
 * マッチングの仕組みは作らない。URL を送って合流してもらう形にしておけば、
 * 同時接続が少ないうちでも「人がいなくて遊べない」が起きない（ゴール定義 §2）。
 */
export function Lobby({ state, myId, inviteUrl, onStart, onChooseJob }: Props) {
  const [copied, setCopied] = useState(false);
  /*
   * 初回だけ自動で開く。
   *
   * ボタンを置くだけだと、たいていの人は押さずに「はじめる」を押す。
   * ターン制であることと松明が減ることは画面を見ても分からないので、
   * 一度は通ってもらう。2回目からは自分で開く。
   */
  const [howTo, setHowTo] = useState(() => !howToSeen());
  useEffect(() => {
    if (howTo) markHowToSeen();
  }, [howTo]);

  const players = state.actors.filter((a) => a.kind === 'player');
  const me = players.find((p) => p.id === myId);
  const myJob: JobId = (me?.job as JobId | null) ?? 'warrior';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // http の LAN 越しだとクリップボードが使えない。URL は下に出してあるので手で選べる
      setCopied(false);
    }
  };

  return (
    <div className="lobby">
      <header className="title">
        <h1>ダンジョンへ</h1>
        <p className="lead">
          仲間と交代で1手ずつ。5階まで降りれば踏破。
          <br />
          松明が消える前に。
        </p>
      </header>

      <section>
        <h2>職業をえらぶ</h2>
        <div className="jobs">
          {JOB_IDS.map((id) => {
            const job = JOBS[id];
            const chosen = id === myJob;
            // 同じ職業が重なってもいい。選びたいものを選べないほうが困る。
            // 誰が何を選んだかは下の一覧で見える
            const others = players.filter((p) => p.id !== myId && p.job === id);
            return (
              <button
                key={id}
                className={`job-card${chosen ? ' on' : ''}`}
                onClick={() => onChooseJob(id)}
              >
                <span className="job-glyph">{job.glyph}</span>
                <span className="job-name">{job.name}</span>
                <span className="job-tag">{job.tagline}</span>
                <span className="job-stats">
                  体力{job.maxHp} 攻{job.atk} 防{job.def}
                </span>
                <span className="job-skill">
                  {job.skill.name} — {job.skill.desc}
                </span>
                {others.length > 0 && (
                  <span className="job-others">
                    {others.map((p) => `${p.slot}番`).join('・')}も
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2>
          仲間 {players.length} / {MAX_PLAYERS}
        </h2>
        <ul className="party-list">
          {players.map((p) => (
            <li key={p.id}>
              <b>{p.slot}</b> {jobOf(p.job).glyph} {jobOf(p.job).name}
              {p.id === myId && <span className="you">あなた</span>}
            </li>
          ))}
        </ul>
        <input className="invite" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
        <button className="wide" onClick={copy}>
          {copied ? 'コピーした' : 'この URL を送って呼ぶ'}
        </button>
        {/* 開発中だけの注意。公開したらインターネット越しに入れるので出さない */}
        {import.meta.env.DEV && (
          <p className="hint">
            開発中は同じ Wi-Fi に繋いでから開くこと（Network: の URL を使う）。
          </p>
        )}
      </section>

      <div className="menu-actions">
        <button className="wide" onClick={() => setHowTo(true)}>
          あそびかた
        </button>
        <button className="wide primary" onClick={onStart}>
          はじめる
        </button>
      </div>
      <p className="hint">1人でも始められる。後から合流もできる。</p>

      {howTo && <HowTo onClose={() => setHowTo(false)} />}
    </div>
  );
}
