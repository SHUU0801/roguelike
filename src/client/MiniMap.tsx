import type { CSSProperties } from 'react';
import { tileAt, type GameState } from '../shared/types';

type Props = {
  state: GameState;
  myId: string;
  onClose: () => void;
};

/** マスに乗せる印。優先順位は 自分 > 仲間 > 倒れた仲間 > 敵 > アイテム */
type Mark = { cls: string; label: string };

/**
 * 全体マップ。
 *
 * 盤面のカメラは自キャラ中心の 9×11 しか映さない。視界は仲間と共有しているのに、
 * 仲間が照らした部屋は画面の外にあって見えない（03_改善構成.md 段階C）。
 * フロア全体を一度に出して「仲間がどこにいるか」「階段は見つかったか」
 * 「どこがまだ未踏か」を1画面で分かるようにする。
 *
 * 出す情報は盤面とまったく同じ規則に従う。知らないことは描かない:
 *
 *   未踏のマス         … 真っ黒
 *   見たことがあるマス … 地形だけ（暗く）
 *   今見えているマス   … 地形を明るく + 乗っているもの
 *
 * `state.floor.tiles` にはフロア全体が入っているので、ここで `seen` を見なければ
 * 地図は一瞬で全部描ける。そうしないのは、それがこのゲームの視界の決まりだから。
 * クライアントはサーバーの状態を描くだけで、見せる範囲を自分で決め直さない。
 */
export function MiniMap({ state, myId, onClose }: Props) {
  const { floor } = state;
  const marks = markers(state, myId);

  /*
   * 階段を見つけたかどうかだけを出す。
   *
   * 「踏破 100%」のような進捗率も作ってみたが、2つの理由でやめた。
   * 未踏のマスの大半は岩盤なので、画面が半分黒いまま 100% と出て壊れて見える。
   * そして 100% は「もう探す場所は無い」という、まだ見ていない情報そのもの。
   * 見たものだけを描くのがこのゲームの決まりなので、進捗率は決まりの外にある。
   * 階段が見つかったかどうかは、見たマスから分かることなので出してよい。
   */
  const stairsFound = floor.tiles.some((t, i) => t === 'stairs' && floor.seen[i]);

  const cells = [];
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const i = y * floor.width + x;
      const visible = floor.visible[i];
      const seen = floor.seen[i];
      const mark = visible ? marks.get(i) : undefined;

      cells.push(
        <div
          key={i}
          className={[
            'mini-cell',
            seen ? tileAt(floor, x, y) : 'unseen',
            seen && !visible ? 'dim' : '',
            mark ? mark.cls : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {mark?.label}
        </div>,
      );
    }
  }

  /*
   * 列数だけ渡し、マスの正方形は CSS 側の aspect-ratio:1 に任せる。
   * 枠に aspect-ratio を掛けて行を 1fr で割る書き方も試したが、
   * 行の最小高さ（min-height:auto）が勝って縦に伸び、マスが横長になった。
   * マス自身を正方形にすれば、フロアが正方形でなくても形が保たれる。
   */
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(${floor.width}, minmax(0, 1fr))`,
  };

  return (
    // 外側をタップしても閉じる。見るだけの画面なので、閉じ方は多いほうがいい
    <div className="map-overlay" onClick={onClose}>
      <div className="map-panel" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>{floor.depth}F</b>
          <span className="map-progress">ターン {state.turn}</span>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="mini" style={grid}>
          {cells}
        </div>

        {/* 色見本と文字を1つにまとめる。並べただけだと、折り返しで
            色見本が前の行に、文字が次の行に離れてしまう */}
        <div className="map-legend">
          {[
            ['me', '自分'],
            ['ally', '仲間'],
            ['down', '倒れた'],
            ['foe', '敵'],
            ['item', '落ちもの'],
            ['stairs', '階段'],
          ].map(([cls, label]) => (
            <span className="legend-item" key={cls}>
              <span className={`key ${cls}`} />
              {label}
            </span>
          ))}
        </div>

        <p className="hint">
          {stairsFound
            ? '階段は見つかっている。全員で「降りる」に同意すると進む'
            : 'まだ階段が見つかっていない。散って探すと早い'}
        </p>
      </div>
    </div>
  );
}

/**
 * マスの番号から印を引けるようにしておく。
 * マスごとに actors を線形探索すると、フロアの広さ × 人数ぶん無駄に回る。
 */
function markers(state: GameState, myId: string): Map<number, Mark> {
  const { floor } = state;
  const marks = new Map<number, Mark>();
  const at = (x: number, y: number) => y * floor.width + x;
  const visible = (x: number, y: number) => floor.visible[at(x, y)] === true;

  // 落ちものが一番下。上に何か乗っていれば上書きされる
  for (const item of state.items) {
    if (!item.pos) continue;
    if (!visible(item.pos.x, item.pos.y)) continue;
    marks.set(at(item.pos.x, item.pos.y), { cls: 'item', label: '' });
  }

  for (const actor of state.actors) {
    if (!visible(actor.pos.x, actor.pos.y)) continue;
    if (actor.kind === 'monster') {
      if (!actor.alive) continue;
      marks.set(at(actor.pos.x, actor.pos.y), { cls: 'foe', label: '' });
    }
  }

  // 倒れた人を先に置き、そのあと生きている人で上書きする。
  // 死体の上を仲間が通れるので、同じマスに2人分の印が要る場面がある
  for (const actor of state.actors) {
    if (actor.kind !== 'player' || actor.alive) continue;
    if (!visible(actor.pos.x, actor.pos.y)) continue;
    // 倒れていても自分は自分だと分かるようにする。
    // 幽霊偵察で動き回るので、どれが自分か分からないと地図が読めない
    marks.set(at(actor.pos.x, actor.pos.y), {
      cls: actor.id === myId ? 'down mine' : 'down',
      label: String(actor.slot),
    });
  }

  for (const actor of state.actors) {
    if (actor.kind !== 'player' || !actor.alive) continue;
    if (!visible(actor.pos.x, actor.pos.y)) continue;
    marks.set(at(actor.pos.x, actor.pos.y), {
      cls: actor.id === myId ? 'me' : 'ally',
      label: String(actor.slot),
    });
  }

  return marks;
}
