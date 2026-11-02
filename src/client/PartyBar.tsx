import { jobOf } from '../shared/jobs';
import { Icon } from './Icon';
import type { GameState } from '../shared/types';

type Props = {
  state: GameState;
  myId: string;
};

/**
 * 仲間の体力と、誰の行動を待っているか。
 * 同期ターン制では「今なぜ進まないのか」が見えないと不安になるので、
 * 待っている相手を名指しで出す。
 */
export function PartyBar({ state, myId }: Props) {
  /*
   * 自分のチームだけ出す。
   *
   * 協力モードはプレイヤーが全員チーム A なので**変化ゼロ**。
   * 対戦では、見えている相手がここに並ぶと「味方の一覧」に敵が混ざる。
   * 相手の HP は盤の上で見るもので、この行の役目は
   * 「誰の行動を待っているか」なので、自陣だけでいい。
   */
  const myTeam = state.actors.find((a) => a.id === myId)?.team;
  const players = state.actors.filter(
    (a) => a.kind === 'player' && (myTeam === undefined || a.team === myTeam),
  );
  if (players.length < 2) return null;

  const waiting = new Set(state.waitingFor);

  return (
    <div className="party">
      {players.map((p) => (
        <span
          key={p.id}
          className={[
            'party-chip',
            p.id === myId ? 'mine' : '',
            !p.alive ? 'down' : '',
            waiting.has(p.id) ? 'waiting' : 'ready',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <b>{p.name || p.slot}</b>
          {/* 誰が何の職業かは、物を渡す相手を決めるのに要る */}
          <Icon id={jobOf(p.job).icon} size={16} />
          {p.alive ? `${p.hp}/${p.maxHp}` : '倒れた'}
          <span className="chip-lv">Lv{p.level}</span>
        </span>
      ))}
    </div>
  );
}
