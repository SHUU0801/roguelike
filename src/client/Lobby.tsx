import { useEffect, useState } from 'react';
import { DUNGEONS, DUNGEON_IDS, dungeonOf, isUnlocked, type DungeonId } from '../shared/dungeons';
import { itemDefOf, type ItemId } from '../shared/items';
import { JOBS, JOB_IDS, jobOf, type JobId } from '../shared/jobs';
import { BASE_SKILL, SKILLS, skillOf, type SkillId } from '../shared/skills';
import {
  BAG_H,
  BAG_W,
  MAX_PLAYERS,
  TEAM_SIZE,
  VERSUS_PLAYERS,
  type GameState,
} from '../shared/types';
import { Backpack } from './Backpack';
import { HowTo } from './HowTo';
import { Icon, JobIcon, Portrait, TileIcon } from './Icon';
import { Invite } from './Invite';
import { ProfileSheet } from './ProfileSheet';
import { loadProfile, userLevel } from './profile';
import { learnedOf, loadCleared, loadStash, tutorialDone } from './stash';

type Props = {
  state: GameState;
  myId: string;
  inviteUrl: string;
  onStart: () => void;
  onChooseJob: (job: JobId) => void;
  onLoadout: (items: ItemId[]) => void;
  onSkillPick: (skillId: SkillId | null) => void;
  onRename: (name: string) => void;
  /** 袋の並べ替え。盤の上と同じ口（ターンは使わない） */
  onMoveItem: (instanceId: string, x: number, y: number, rot: number) => void;
  /** 行き先を変える。合流した人は変えられないので null が来る */
  onChooseDungeon: ((id: DungeonId) => void) | null;
  /**
   * 対戦の部屋を作り直す。合流した人は変えられないので null が来る。
   * 部屋ごと作り直すのは、盤が鏡像かどうかが部屋を作るときに決まるため。
   */
  onVersus: (() => void) | null;
};

type Tab = 'home' | 'gear' | 'dungeon';

/** ホームの袋では使えない操作。Backpack は盤と同じ口を要求する */
const noop = () => {};

/**
 * 潜る前の画面。
 *
 * ## 作り直した理由
 *
 * 前の版は**説明文だらけ**だった。「踏破すれば持ち帰れる。倒れたら袋の中身は
 * その場に落ちる」「まだ覚えたわざが無い。潜ってレベルを上げると覚える」——
 * 実際のゲームにこういう文章は無い。
 *
 * 調べた結果、スマホのゲームのホームはどれも同じ形をしていた
 * （08_参考にしたもの.md）。
 *
 *   上      状態（レベル・所持数）。小さく、数字とアイコンだけ
 *   中央    いまのキャラ。一番大きい
 *   親指の位置 主ボタン1つ
 *   最下部  固定のタブ 3〜5 個
 *
 * **文章ではなく、数字・アイコン・見た目の状態で伝える。**
 * 鍵が掛かっているなら錠前の絵、踏破したならチェック、強さは棒グラフ。
 * 説明が要るものは「あそびかた」に押し込む。そこが文章の置き場所。
 */
export function Lobby({
  state,
  myId,
  inviteUrl,
  onStart,
  onChooseJob,
  onLoadout,
  onSkillPick,
  onRename,
  onMoveItem,
  onChooseDungeon,
  onVersus,
}: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [copied, setCopied] = useState(false);
  const [howTo, setHowTo] = useState(false);
  // 文章は自動で出さない。初回に押してほしいのは「やってみる」のほう
  const [tutorialOver] = useState(() => tutorialDone());

  const [stash] = useState(() => loadStash());
  const [cleared] = useState(() => loadCleared());
  const [taking, setTaking] = useState<number[]>([]);
  const [skillPick, setSkillPick] = useState<SkillId | null>(null);
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(() => loadProfile());

  const players = state.actors.filter((a) => a.kind === 'player');
  const me = players.find((p) => p.id === myId);
  const myJob: JobId = (me?.job as JobId | null) ?? 'warrior';
  const job = jobOf(myJob);
  const here = dungeonOf(state.dungeon);
  /*
   * 対戦の部屋かどうか。見た目を変えるのはこの画面だけで、
   * 盤のルールはすべてサーバーが持っている（クライアントは state を描くだけ）。
   */
  const versus = state.mode === 'versus';
  const learned = learnedOf(myJob).filter((id) => id !== BASE_SKILL[myJob]);

  useEffect(() => {
    onLoadout(taking.map((i) => stash[i]).filter(Boolean));
  }, [taking, stash, onLoadout]);

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
      setCopied(false);
    }
  };

  /*
   * 埋まっているマス。**サーバーの袋から数える。**
   * 以前は「職業の基本装備の形 + 選んだものの形」を足していたが、
   * それは実際の詰まり方とは別物で、入らなかったときも気づけなかった。
   * いまは本物の袋があるので、そこを数えればよい。
   */
  const inBag = state.items.filter((i) => i.ownerId === myId && i.at !== null);
  const used = inBag.reduce((n, i) => n + itemDefOf(i.itemId).shape.length, 0);

  /*
   * 選んだのに入らなかった数。
   *
   * 袋はサーバーが詰めるので、入らなかったものは**ただ現れない。**
   * 選んだ絵は光ったままなのに袋に出てこないと、壊れているように見える。
   * 数えて言う。袋の中身から職業の基本装備1つを引けば、持ち込めた数になる。
   */
  const spilled = Math.max(0, taking.length - Math.max(0, inBag.length - 1));

  /** 強さを棒で出す。数字だけだと、職業どうしの差が一目で分からない */
  const bar = (value: number, max: number) => (
    <span className="bar">
      <i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </span>
  );

  const statRows = (j: typeof job) => (
    <div className="stats-grid">
      <Icon id="heart" size={16} />
      {bar(j.maxHp, 32)}
      <b>{j.maxHp}</b>
      <Icon id="sword2" size={16} />
      {bar(j.atk, 10)}
      <b>{j.atk}</b>
      <Icon id="shield2" size={16} />
      {bar(j.def, 5)}
      <b>{j.def}</b>
    </div>
  );

  return (
    <div className="lobby">
      {/* 上の状態。数字とアイコンだけ。説明は書かない */}
      <header className="topbar">
        {/* 自分のところを押すとユーザーの画面。スマホのゲームの定位置 */}
        <button className="chip user" onClick={() => setProfileOpen(true)}>
          <b>Lv{userLevel(profile.exp).level}</b>
          <span className="user-name">{profile.name || 'なまえ未設定'}</span>
        </button>
        <span className="chip">
          <Icon id="check" size={16} />
          {cleared.length}/{DUNGEON_IDS.length}
        </span>
        <span className="spacer" />
        {/*
          「あそびかた」は文章ではなく、やって覚える階へ連れていく。
          長い説明を最初に出しても読まれないし、
          読んでも盤の前に戻ったときには忘れている。
          まだ終えていない人には点を付けて、押す先だと分かるようにする。
        */}
        <button
          className={`icon-btn${tutorialOver ? '' : ' nudge'}`}
          /*
           * 合流した人は行き先を変えられない（部屋ごと作り直しになるので）。
           * その人には文章版を出す。押しても何も起きないボタンにするより、
           * 読めるものがあるほうがいい。
           */
          onClick={() => (onChooseDungeon ? onChooseDungeon('tutorial') : setHowTo(true))}
        >
          <Icon id="question" size={16} />
          <span>あそびかた</span>
        </button>
      </header>

      <div className="lobby-body">
        {tab === 'home' && (
          <div className="home">
            {/* 中央にキャラ。一番大きい */}
            <div className="hero-stage">
              {/* 立ち絵。盤の 16x16 ではなく、ホーム専用の 128x128 */}
              <span className="hero-art">
                <Portrait job={myJob} size={128} />
              </span>
              <div className="hero-name">
                <Icon id={job.icon} size={16} />
                <b>{job.name}</b>
              </div>
              {statRows(job)}
            </div>

            {/* 支度の要約。押すとそのタブへ */}
            <div className="quick">
              <button className="quick-cell" onClick={() => setTab('gear')}>
                <Icon id={SKILLS[BASE_SKILL[myJob]].icon} size={32} />
                {skillPick && <Icon id={SKILLS[skillPick].icon} size={32} />}
                <span className="quick-label">わざ {skillPick ? 2 : 1}</span>
              </button>
              <button className="quick-cell" onClick={() => setTab('gear')}>
                <TileIcon id={itemDefOf(job.startingItem).sprite} size={32} />
                <span className="quick-label">
                  {used}/{BAG_W * BAG_H}
                </span>
              </button>
              <button className="quick-cell" onClick={() => setTab('dungeon')}>
                <Icon id={here.icon} size={32} />
                <span className="quick-label">B{here.depth}F</span>
              </button>
            </div>

            {/*
              仲間（対戦なら相手）。顔を並べるだけ。空きは丸で出す。
              対戦の枠は TEAM_SIZE * 2。空いた席は始めるときに AI が埋める
              ので、1人でも押せる（03_改善構成.md 段階D D6）。
            */}
            <div className="party-row">
              {Array.from({ length: versus ? VERSUS_PLAYERS : MAX_PLAYERS }, (_, i) => {
                const p = players[i];
                return (
                  <span key={i} className={`slot-face${p ? '' : ' empty'}`} title={p?.name}>
                    {p ? <JobIcon job={p.job ?? 'warrior'} size={32} /> : null}
                    {p?.name && <span className="face-name">{p.name}</span>}
                  </span>
                );
              })}
              <button className="icon-btn wide-chip" onClick={() => setInviting(true)}>
                <Icon id="map" size={16} />
                <span>さそう</span>
              </button>
            </div>

            {/*
              協力 ⇄ 対戦の行き来。
              部屋を作るときにしか決められないので、押すとページ遷移になる。
              合流した人は変えられない（onVersus が null）。
            */}
            {versus ? (
              <button
                className="icon-btn wide-chip"
                disabled={onChooseDungeon === null}
                onClick={() => onChooseDungeon?.('ruin')}
              >
                <Icon id="helmet" size={16} />
                <span>協力にもどる</span>
              </button>
            ) : (
              <button
                className="icon-btn wide-chip"
                disabled={onVersus === null}
                onClick={() => onVersus?.()}
              >
                <Icon id="sword2" size={16} />
                <span>対戦（AI 相手）</span>
              </button>
            )}

          </div>
        )}

        {tab === 'gear' && (
          <div className="gear">
            <div className="gear-head">
              <span className="hero-art small">
                <Portrait job={myJob} size={96} />
              </span>
              <div className="gear-stats">
                <b>{job.name}</b>
                {statRows(job)}
              </div>
            </div>

            <div className="row-icons">
              {JOB_IDS.map((id) => (
                <button
                  key={id}
                  className={`pick-tile${id === myJob ? ' on' : ''}`}
                  aria-label={JOBS[id].name}
                  onClick={() => onChooseJob(id)}
                >
                  <Icon id={JOBS[id].icon} size={32} />
                  <span>{JOBS[id].name}</span>
                </button>
              ))}
            </div>

            {/* わざは枠で出す。空き枠を押すと選ぶ */}
            <div className="skill-slots">
              <div className="skill-slot filled">
                <Icon id={SKILLS[BASE_SKILL[myJob]].icon} size={32} />
                <span>{skillOf(BASE_SKILL[myJob]).name}</span>
              </div>
              <button
                className={`skill-slot${skillPick ? ' filled' : ''}${learned.length ? '' : ' locked'}`}
                disabled={learned.length === 0}
                onClick={() => setPicking(true)}
              >
                {skillPick ? (
                  <>
                    <Icon id={SKILLS[skillPick].icon} size={32} />
                    <span>{skillOf(skillPick).name}</span>
                  </>
                ) : (
                  <>
                    <Icon id={learned.length ? 'star' : 'lock'} size={32} />
                    <span>{learned.length ? `＋${learned.length}` : '—'}</span>
                  </>
                )}
              </button>
            </div>

            {/*
              袋。**盤の上とまったく同じ部品**（Backpack）。

              前はここだけ「何マス埋まるか」を数えた目盛りで、
              中身は触れなかったし、剣が縦3マスであることも分からなかった。
              本物を出せば、潜る前に詰め方を決められる。
              使う・はずす・置くはターンを使う操作なので、ここでは出ない。
            */}
            {/* 「何マス使っているか」は Backpack が自分で出す。ここでは重ねない */}
            <Backpack
              state={state}
              ownerId={myId}
              mine
              canArrange
              canAct={false}
              onUse={noop}
              onDrop={noop}
              onToggleEquip={noop}
              onMove={onMoveItem}
            />
            {/* 入らなかったぶん。黙って消えるのが一番たちが悪い */}
            {spilled > 0 && (
              <p className="warn">
                {spilled}つ入らなかった。袋を詰め直すか、持ち込みを減らす。
              </p>
            )}

            {/*
              倉庫からの持ち込み。**対戦では出さない。**
              対戦の持ち物はドラフトで配る（03_改善構成.md 段階D D8）ので、
              ここに並べても押せないボタンが並ぶだけになる。
            */}
            {!versus && (
            <div className="row-icons wrap">
              {stash.length === 0 ? (
                <span className="empty-chip">
                  <Icon id="lock" size={16} />
                </span>
              ) : (
                stash.map((id, i) => (
                  <button
                    key={`${id}-${i}`}
                    className={`pick-tile${taking.includes(i) ? ' on' : ''}`}
                    aria-label={itemDefOf(id).name}
                    onClick={() =>
                      setTaking((now) =>
                        now.includes(i) ? now.filter((n) => n !== i) : [...now, i],
                      )
                    }
                  >
                    <TileIcon id={itemDefOf(id).sprite} size={32} />
                    <span>{itemDefOf(id).name}</span>
                  </button>
                ))
              )}
            </div>
            )}
          </div>
        )}

        {tab === 'dungeon' && (
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
                  onClick={() => {
                    onChooseDungeon?.(id);
                    setTab('home');
                  }}
                >
                  <Icon id={open ? d.icon : 'lock'} size={32} />
                  <span className="d-main">
                    <b>{d.name}</b>
                    {/* 難しさは髑髏の数で。文章で書かない */}
                    <span className="skulls">
                      {Array.from({ length: Math.ceil(d.depth / 2) }, (_, i) => (
                        <Icon key={i} id="skull" size={16} />
                      ))}
                    </span>
                  </span>
                  <span className="d-right">
                    <b>B{d.depth}F</b>
                    {cleared.includes(id) && <Icon id="check" size={16} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* わざを選ぶ。枠を押したときだけ出す */}
      {picking && (
        <div className="map-overlay" onClick={() => setPicking(false)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="map-head">
              <b>わざ</b>
              <button onClick={() => setPicking(false)}>閉じる</button>
            </div>
            {learned.map((id) => (
              <button
                key={id}
                className={`skill-row pick${skillPick === id ? ' on' : ''}`}
                onClick={() => {
                  setSkillPick((now) => (now === id ? null : id));
                  setPicking(false);
                }}
              >
                <Icon id={SKILLS[id].icon} size={32} />
                <span className="iname">
                  {skillOf(id).name}
                  <span className="sdesc">{skillOf(id).desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/*
        主ボタンは本文の外に出す。中に置くと、画面が短い端末で
        スクロールの下に隠れた（375x667 で実際に切れていた）。
        スマホのゲームで出撃ボタンが常に見えているのはこのため。
      */}
      {tab === 'home' && (
        <button className="launch" onClick={onStart}>
          <span className="launch-sub">
            {versus
              ? `${TEAM_SIZE}vs${TEAM_SIZE}  空いた席は AI`
              : `${here.name} B${here.depth}F`}
          </span>
          <span className="launch-main">{versus ? '対戦' : '出撃'}</span>
        </button>
      )}

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

      {inviting && <Invite url={inviteUrl} onClose={() => setInviting(false)} />}

      {profileOpen && (
        <ProfileSheet
          onClose={() => {
            setProfileOpen(false);
            setProfile(loadProfile());
          }}
          onRename={onRename}
        />
      )}

      {howTo && <HowTo onClose={() => setHowTo(false)} />}
    </div>
  );
}
