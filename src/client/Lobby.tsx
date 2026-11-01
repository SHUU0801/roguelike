import { useEffect, useState } from 'react';
import { DUNGEONS, DUNGEON_IDS, dungeonOf, isUnlocked, type DungeonId } from '../shared/dungeons';
import { itemDefOf, type ItemId } from '../shared/items';
import { JOBS, JOB_IDS, jobOf, type JobId } from '../shared/jobs';
import { BASE_SKILL, SKILLS, skillOf, type SkillId } from '../shared/skills';
import { BAG_H, BAG_W, MAX_PLAYERS, type GameState } from '../shared/types';
import { HowTo, howToSeen, markHowToSeen } from './HowTo';
import { Icon, TileIcon } from './Icon';
import { learnedOf, loadCleared, loadStash } from './stash';

type Props = {
  state: GameState;
  myId: string;
  inviteUrl: string;
  onStart: () => void;
  onChooseJob: (job: JobId) => void;
  onLoadout: (items: ItemId[]) => void;
  onSkillPick: (skillId: SkillId | null) => void;
  /** 行き先を変える。合流した人は変えられないので null が来る */
  onChooseDungeon: ((id: DungeonId) => void) | null;
};

type Tab = 'home' | 'gear' | 'dungeon';

/**
 * 潜る前の画面。下のタブで3つに分けてある。
 *
 *   ホーム    誰で、どこへ、誰と行くか。そのまま潜れる
 *   そうび    職業・わざ・持ち込み。支度だけをここに集める
 *   ダンジョン 行き先の比較
 *
 * 1枚に全部載せていたら縦に長くなりすぎて、
 * 「はじめる」に辿り着くのにスクロールが要るようになっていた。
 * スマホのゲームが下タブなのは、**親指の届く場所に行き先を置くため**。
 *
 * マッチングの仕組みは作らない。URL を送って合流してもらう形にしておけば、
 * 同時接続が少ないうちでも「人がいなくて遊べない」が起きない（00_ゴール定義.md §2）。
 */
export function Lobby({
  state,
  myId,
  inviteUrl,
  onStart,
  onChooseJob,
  onLoadout,
  onSkillPick,
  onChooseDungeon,
}: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [copied, setCopied] = useState(false);
  /*
   * あそびかたは初回だけ自動で開く。
   * ボタンを置くだけだと、たいていの人は押さずに潜る。
   */
  const [howTo, setHowTo] = useState(() => !howToSeen());
  useEffect(() => {
    if (howTo) markHowToSeen();
  }, [howTo]);

  const [stash] = useState(() => loadStash());
  const [cleared] = useState(() => loadCleared());
  /** 倉庫のどれを持ち込むか。同じものが複数あるので添字で覚える */
  const [taking, setTaking] = useState<number[]>([]);
  const [skillPick, setSkillPick] = useState<SkillId | null>(null);

  const players = state.actors.filter((a) => a.kind === 'player');
  const me = players.find((p) => p.id === myId);
  const myJob: JobId = (me?.job as JobId | null) ?? 'warrior';
  const job = jobOf(myJob);
  const here = dungeonOf(state.dungeon);

  const learned = learnedOf(myJob).filter((id) => id !== BASE_SKILL[myJob]);

  useEffect(() => {
    onLoadout(taking.map((i) => stash[i]).filter(Boolean));
  }, [taking, stash, onLoadout]);

  // 職業を変えたら、持ち込むわざは選び直し（職業の違うわざは使えない）
  useEffect(() => {
    setSkillPick(null);
  }, [myJob]);

  useEffect(() => {
    onSkillPick(skillPick);
  }, [skillPick, onSkillPick]);

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

  const takenCells = taking
    .map((i) => stash[i])
    .filter(Boolean)
    .reduce((n, id) => n + itemDefOf(id).shape.length, 0);
  const jobCells = itemDefOf(job.startingItem).shape.length;
  const used = jobCells + takenCells;
  const overflow = used > BAG_W * BAG_H;

  return (
    <div className="lobby">
      <div className="lobby-body">
        {tab === 'home' && (
          <>
            <header className="title">
              <h1>ダンジョンへ</h1>
              <p className="lead">
                仲間と交代で1手ずつ。<b>踏破すれば持ち帰れる。</b>
                <br />
                倒れたら袋の中身はその場に落ちる。
              </p>
            </header>

            <section className="me-card">
              <span className="me-sprite">
                <TileIcon id={job.sprite} size={48} />
              </span>
              <span className="me-info">
                <b>{job.name}</b>
                <span className="job-stats">
                  体力{job.maxHp} 攻{job.atk} 防{job.def}
                </span>
                <span className="job-tag">{job.tagline}</span>
              </span>
            </section>

            {/* いまの支度の要約。そうびタブを開かなくても確認できる */}
            <section className="summary">
              <button className="sum-row" onClick={() => setTab('gear')}>
                <span className="sum-label">わざ</span>
                <span className="sum-value">
                  {skillOf(BASE_SKILL[myJob]).name}
                  {skillPick && ` ／ ${skillOf(skillPick).name}`}
                </span>
              </button>
              <button className="sum-row" onClick={() => setTab('gear')}>
                <span className="sum-label">持ち込み</span>
                <span className="sum-value">
                  {used} / {BAG_W * BAG_H} マス
                </span>
              </button>
              <button className="sum-row" onClick={() => setTab('dungeon')}>
                <span className="sum-label">行き先</span>
                <span className="sum-value">
                  {here.name}（{here.depth}階）
                </span>
              </button>
            </section>

            <section>
              <h2>
                仲間 {players.length} / {MAX_PLAYERS}
              </h2>
              <ul className="party-list">
                {players.map((p) => (
                  <li key={p.id}>
                    <b>{p.slot}</b> <Icon id={jobOf(p.job).icon} size={16} />{' '}
                    {jobOf(p.job).name}
                    {p.id === myId && <span className="you">あなた</span>}
                  </li>
                ))}
              </ul>
              <input
                className="invite"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
              />
              <button className="wide" onClick={copy}>
                {copied ? 'コピーした' : 'この URL を送って呼ぶ'}
              </button>
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
                {here.name}へ潜る
              </button>
            </div>
            <p className="hint">1人でも始められる。後から合流もできる。</p>
          </>
        )}

        {tab === 'gear' && (
          <>
            <section>
              <h2>職業</h2>
              <div className="jobs">
                {JOB_IDS.map((id) => {
                  const j = JOBS[id];
                  const others = players.filter((p) => p.id !== myId && p.job === id);
                  return (
                    <button
                      key={id}
                      className={`job-card${id === myJob ? ' on' : ''}`}
                      onClick={() => onChooseJob(id)}
                    >
                      <Icon id={j.icon} size={32} />
                      <span className="job-name">{j.name}</span>
                      <span className="job-tag">{j.tagline}</span>
                      <span className="job-stats">
                        体力{j.maxHp} 攻{j.atk} 防{j.def}
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
                わざ <span className="hint-inline">持ち込めるのは1つ</span>
              </h2>
              <div className="skill-list">
                <div className="skill-row base">
                  <Icon id={SKILLS[BASE_SKILL[myJob]].icon} size={32} />
                  <span className="iname">
                    {skillOf(BASE_SKILL[myJob]).name}
                    <span className="sdesc">{skillOf(BASE_SKILL[myJob]).desc}</span>
                  </span>
                  <span className="tagline-chip">最初から</span>
                </div>

                {learned.length === 0 ? (
                  <p className="hint">
                    まだ覚えたわざが無い。<b>潜ってレベルを上げると覚える。</b>
                    踏破して帰れば、次からここで持ち込める。
                  </p>
                ) : (
                  learned.map((id) => (
                    <button
                      key={id}
                      className={`skill-row pick${skillPick === id ? ' on' : ''}`}
                      onClick={() => setSkillPick((now) => (now === id ? null : id))}
                    >
                      <Icon id={SKILLS[id].icon} size={32} />
                      <span className="iname">
                        {skillOf(id).name}
                        <span className="sdesc">{skillOf(id).desc}</span>
                      </span>
                      <span className="tagline-chip">
                        {skillPick === id ? '持ち込む' : '選ぶ'}
                      </span>
                    </button>
                  ))
                )}
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
                        onClick={() =>
                          setTaking((now) =>
                            now.includes(i) ? now.filter((n) => n !== i) : [...now, i],
                          )
                        }
                      >
                        <TileIcon id={itemDefOf(id).sprite} size={32} />
                        <span>{itemDefOf(id).name}</span>
                      </button>
                    ))}
                  </div>
                  <p className={overflow ? 'warn' : 'hint'}>
                    {used} / {BAG_W * BAG_H} マス
                    {overflow && '（入りきらない分は置いていくことになる）'}
                  </p>
                </>
              )}
            </section>
          </>
        )}

        {tab === 'dungeon' && (
          <section>
            <h2>どこへ潜るか</h2>
            {onChooseDungeon === null && (
              <p className="hint">合流したので、行き先は部屋を作った人が決めている。</p>
            )}
            <div className="dungeons">
              {DUNGEON_IDS.map((id) => {
                const d = DUNGEONS[id];
                const open = isUnlocked(id, cleared);
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
                    {cleared.includes(id) && <span className="d-done">踏破ずみ</span>}
                  </button>
                );
              })}
            </div>
            <button className="wide primary" onClick={() => setTab('home')}>
              決めた
            </button>
          </section>
        )}
      </div>

      {/* 下タブ。親指の届く場所に置く */}
      <nav className="tabs">
        {(
          [
            ['home', 'ホーム', 'helmet'],
            ['gear', 'そうび', 'sword2'],
            ['dungeon', 'ダンジョン', 'map'],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            className={`tab${tab === id ? ' on' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon id={icon} size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {howTo && <HowTo onClose={() => setHowTo(false)} />}
    </div>
  );
}
