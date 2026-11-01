import { useEffect, useState } from 'react';
import { DUNGEONS, DUNGEON_IDS, dungeonOf, isUnlocked, type DungeonId } from '../shared/dungeons';
import { itemDefOf, type ItemId } from '../shared/items';
import { JOBS, JOB_IDS, jobOf, type JobId } from '../shared/jobs';
import { BAG_H, BAG_W, MAX_PLAYERS, type GameState } from '../shared/types';
import { HowTo, howToSeen, markHowToSeen } from './HowTo';
import { Icon, TileIcon } from './Icon';
import { loadCleared, loadStash } from './stash';

type Props = {
  state: GameState;
  myId: string;
  inviteUrl: string;
  onStart: () => void;
  onChooseJob: (job: JobId) => void;
  onLoadout: (items: ItemId[]) => void;
  /** 行き先を変える。合流した人は変えられないので null が来る */
  onChooseDungeon: ((id: DungeonId) => void) | null;
};

/**
 * ホーム。潜る前にここで支度をする。
 *
 * もとは見出しと URL 欄と開始ボタンだけで、
 * 何のゲームか分からないまま唐突に潜らされていた。いまは4つ置いてある。
 *
 *   自分のキャラ  いま何者で、どれだけ強いか
 *   行き先        どのダンジョンへ潜るか（踏破すると次が開く）
 *   持ち込み      倉庫から袋に詰めるもの
 *   仲間          URL を送って呼ぶ
 *
 * マッチングの仕組みは作らない。URL を送って合流してもらう形にしておけば、
 * 同時接続が少ないうちでも「人がいなくて遊べない」が起きない（ゴール定義 §2）。
 */
export function Lobby({
  state,
  myId,
  inviteUrl,
  onStart,
  onChooseJob,
  onLoadout,
  onChooseDungeon,
}: Props) {
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

  const [stash] = useState(() => loadStash());
  const [cleared] = useState(() => loadCleared());
  /** 倉庫のどれを持ち込むか。倉庫の添字で覚える（同じものが複数あるため） */
  const [taking, setTaking] = useState<number[]>([]);

  const players = state.actors.filter((a) => a.kind === 'player');
  const me = players.find((p) => p.id === myId);
  const myJob: JobId = (me?.job as JobId | null) ?? 'warrior';
  const here = dungeonOf(state.dungeon);

  // 選んだものをサーバーへ。袋に入りきらない分は向こうで落とされる
  useEffect(() => {
    onLoadout(taking.map((i) => stash[i]).filter(Boolean));
  }, [taking, stash, onLoadout]);

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

  const toggleTake = (i: number) => {
    setTaking((now) => (now.includes(i) ? now.filter((n) => n !== i) : [...now, i]));
  };

  const takenCells = taking
    .map((i) => stash[i])
    .filter(Boolean)
    .reduce((n, id) => n + itemDefOf(id).shape.length, 0);
  const jobCells = itemDefOf(jobOf(myJob).startingItem).shape.length;
  const overflow = takenCells + jobCells > BAG_W * BAG_H;

  return (
    <div className="lobby">
      <header className="title">
        <h1>ダンジョンへ</h1>
        <p className="lead">
          仲間と交代で1手ずつ。<b>踏破すれば持ち帰れる。</b>
          <br />
          倒れたら袋の中身はその場に落ちる。
        </p>
      </header>

      {/* 自分のキャラ。いま何者かを一目で */}
      <section className="me-card">
        <span className="me-sprite">
          <TileIcon id={jobOf(myJob).sprite} size={48} />
        </span>
        <span className="me-info">
          <b>{jobOf(myJob).name}</b>
          <span className="job-stats">
            体力{jobOf(myJob).maxHp} 攻{jobOf(myJob).atk} 防{jobOf(myJob).def}
          </span>
          <span className="job-tag">{jobOf(myJob).tagline}</span>
        </span>
      </section>

      <section>
        <h2>どこへ潜るか</h2>
        {onChooseDungeon === null && (
          <p className="hint">合流したので、行き先は部屋を作った人が決めている。</p>
        )}
        <div className="dungeons">
          {DUNGEON_IDS.map((id) => {
            const d = DUNGEONS[id];
            const open = isUnlocked(id, cleared);
            const done = cleared.includes(id);
            return (
              <button
                key={id}
                className={`dungeon-card${id === state.dungeon ? ' on' : ''}${
                  open ? '' : ' locked'
                }`}
                disabled={!open || onChooseDungeon === null}
                onClick={() => onChooseDungeon?.(id)}
              >
                <span className="d-head">
                  <Icon id={d.icon} size={16} />
                  <b>{d.name}</b>
                  <span className="d-depth">{d.depth}階</span>
                </span>
                <span className="d-tag">
                  {open ? d.tagline : `${dungeonOf(d.requires).name}を踏破すると開く`}
                </span>
                {done && <span className="d-done">踏破ずみ</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2>職業をえらぶ</h2>
        <div className="jobs">
          {JOB_IDS.map((id) => {
            const job = JOBS[id];
            // 同じ職業が重なってもいい。選びたいものを選べないほうが困る
            const others = players.filter((p) => p.id !== myId && p.job === id);
            return (
              <button
                key={id}
                className={`job-card${id === myJob ? ' on' : ''}`}
                onClick={() => onChooseJob(id)}
              >
                <Icon id={job.icon} size={32} />
                <span className="job-name">{job.name}</span>
                <span className="job-tag">{job.tagline}</span>
                <span className="job-stats">
                  体力{job.maxHp} 攻{job.atk} 防{job.def}
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
          持ち込む{' '}
          <span className="hint-inline">
            袋は {BAG_W}×{BAG_H} マス
          </span>
        </h2>
        {stash.length === 0 ? (
          <p className="hint">
            倉庫は空。<b>踏破すると袋の中身を持ち帰れる。</b>倒れたら持ち帰れない。
          </p>
        ) : (
          <>
            <div className="stash">
              {stash.map((id, i) => (
                <button
                  key={`${id}-${i}`}
                  className={`stash-item${taking.includes(i) ? ' on' : ''}`}
                  onClick={() => toggleTake(i)}
                >
                  <TileIcon id={itemDefOf(id).sprite} size={32} />
                  <span>{itemDefOf(id).name}</span>
                </button>
              ))}
            </div>
            <p className={overflow ? 'warn' : 'hint'}>
              {jobCells + takenCells} / {BAG_W * BAG_H} マス
              {overflow && '（入りきらない分は置いていくことになる）'}
            </p>
          </>
        )}
      </section>

      <section>
        <h2>
          仲間 {players.length} / {MAX_PLAYERS}
        </h2>
        <ul className="party-list">
          {players.map((p) => (
            <li key={p.id}>
              <b>{p.slot}</b> <Icon id={jobOf(p.job).icon} size={16} /> {jobOf(p.job).name}
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
          {here.name}へ
        </button>
      </div>
      <p className="hint">1人でも始められる。後から合流もできる。</p>

      {howTo && <HowTo onClose={() => setHowTo(false)} />}
    </div>
  );
}
