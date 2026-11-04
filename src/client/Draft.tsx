import { itemDefOf, type ItemId } from '../shared/items';
import { DRAFT_ROUNDS, teamOf, type GameState } from '../shared/types';
import { Icon, TileIcon } from './Icon';
import { useSecondsLeft } from './clock';

type Props = {
  state: GameState;
  myId: string;
  onPick: (itemId: ItemId) => void;
};

/**
 * 潜る前の支度（03_改善構成.md 段階D D8）。
 *
 * ## なぜこれがあるか
 *
 * 対戦の盤は鏡像で、置いてあるものも職業も左右で同じにしてある。
 * **そこまで揃えると、今度は差が無さすぎる。**
 * 最初の持ち物を選ばせることで、同じ盤でも違う戦い方が生まれる。
 *
 * 倉庫からの持ち込みを対戦で切った（game.ts）代わりでもある。
 * 周回した人が強い状態で出てくるのではなく、
 * **その場で等しく配られたものから何を選ぶか**にした。
 *
 * ## 画面に出すこと
 *
 * 先に選ぶ側は巡ごとに入れ替わる。それが見えないと
 * 「なんで相手が先なの」になるので、巡と番を上に出す。
 * 相手が取ったものも出す。隠すと読み合いが成立しない。
 */
export function Draft({ state, myId, onPick }: Props) {
  const draft = state.draft;
  if (!draft) return null;

  const me = state.actors.find((a) => a.id === myId);
  const myTeam = me ? teamOf(me) : null;
  const foeTeam = myTeam === 'A' ? 'B' : 'A';
  const mine = myTeam ? draft.taken[myTeam] : [];
  const theirs = myTeam ? draft.taken[foeTeam] : [];
  const myTurn = myTeam !== null && draft.picking === myTeam;

  /*
   * 持ち時間。人間が1人のとき（相手が AI）はサーバーが動かさないので null。
   * 急かす相手がいないのに秒数が出ていると、落ち着いて比べられない。
   */
  const left = useSecondsLeft(draft.deadlineAt);
  /** 残りが少ない。押し忘れで取られる手前なので、ここだけ色を変える */
  const hurry = left !== null && left <= 10;

  const row = (label: string, list: ItemId[]) => (
    <div className="draft-row">
      <span className="draft-label">{label}</span>
      {Array.from({ length: DRAFT_ROUNDS }, (_, i) => {
        const id = list[i];
        return (
          <span key={i} className={`draft-slot${id ? ' on' : ''}`}>
            {id ? <TileIcon id={itemDefOf(id).sprite} size={32} /> : null}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="draft">
      <header className="draft-head">
        <b>したく</b>
        <span className="draft-round">
          {draft.round + 1} / {DRAFT_ROUNDS} 巡
        </span>
      </header>

      {/* いま誰の番か。ここが分からないと、押せない理由が分からない */}
      <p className={`draft-turn${myTurn ? ' mine' : ''}`}>
        {myTurn ? 'あなたの番。1つ取る' : '相手が選んでいる…'}
        {/*
          残り秒。**自分の番でなくても出す。**
          相手が止まっているのか、あと何秒で進むのかが分からないと、
          待っている側は切断を疑って部屋を出てしまう。
        */}
        {left !== null && <span className={`draft-clock${hurry ? ' hurry' : ''}`}>{left}</span>}
      </p>

      <div className="draft-offer">
        {draft.offer.map((id) => {
          const def = itemDefOf(id);
          return (
            <button
              key={id}
              className="draft-card"
              disabled={!myTurn}
              onClick={() => onPick(id)}
            >
              <TileIcon id={def.sprite} size={48} />
              <b>{def.name}</b>
              {/* 効果は数字で。文章だと読まれないし、読んでも比べられない */}
              {def.equip ? (
                <span className="draft-stat">
                  {def.equip.atk !== undefined && def.equip.atk !== 0 && (
                    <>
                      <Icon id="sword2" size={16} />
                      {def.equip.atk > 0 ? `+${def.equip.atk}` : def.equip.atk}
                    </>
                  )}
                  {def.equip.def !== undefined && def.equip.def !== 0 && (
                    <>
                      <Icon id="shield2" size={16} />
                      {def.equip.def > 0 ? `+${def.equip.def}` : def.equip.def}
                    </>
                  )}
                </span>
              ) : (
                <span className="draft-stat">つかう</span>
              )}
            </button>
          );
        })}
      </div>

      {/*
        取ったもの。**相手のぶんも出す。**
        隠すと「相手が剣を取ったから盾にする」という読み合いが成立しない。
      */}
      <div className="draft-taken">
        {row('あなた', mine)}
        {row('あいて', theirs)}
      </div>

      <p className="draft-note">
        {/* 1つ流れることを先に言う。取り損ねたと思われないように */}
        {draft.offer.length}つのうち1つを取る。残りは流れる。
        {/*
          切れたらどうなるかを先に書く。「取られる」と分かっていれば
          押し忘れが事故にならないし、わざと放置する人も減る。
        */}
        {left !== null && ' 時間切れになると、かわりに取られる。'}
      </p>
    </div>
  );
}
