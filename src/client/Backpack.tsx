import { useState, type CSSProperties } from 'react';
import { itemDefOf, rotated, shapeSize } from '../shared/items';
import { BAG_H, BAG_W, type GameState, type ItemInstance } from '../shared/types';
import { TileIcon } from './Icon';

type Props = {
  state: GameState;
  /** 誰の袋を見ているか */
  ownerId: string;
  /** 自分の袋か。他人の袋は見るだけ */
  mine: boolean;
  playing: boolean;
  onUse: (instanceId: string) => void;
  onDrop: (instanceId: string) => void;
  onMove: (instanceId: string, x: number, y: number, rot: number) => void;
};

/**
 * マス目のバックパック。
 *
 * 「6個まで」という数の制限をやめて形で詰める形にした。
 * 数だけだと薬草6個と剣6本が同じ重さになる。形があると
 * 「剣は縦3マス食うから、もう1本は諦めて薬草を入れる」が生まれる。
 *
 * ## 操作は「持ち上げる → 置く」
 *
 * ドラッグにしない。スマホで指を滑らせる操作は、
 * 盤面のスクロールや戻るジェスチャと取り合いになるうえ、
 * 1マス 40px 前後だと狙ったマスに落とせない。
 *
 * アイテムを押す → 持ち上がる（使う・置く・回すが出る）
 * 空きマスを押す → そこへ移動する
 * もう一度押す   → やめる
 *
 * 置ける場所は持ち上げている間だけ緑で示す。
 * どこに入るか分からないまま総当たりさせない。
 */
export function Backpack({
  state,
  ownerId,
  mine,
  playing,
  onUse,
  onDrop,
  onMove,
}: Props) {
  const [held, setHeld] = useState<string | null>(null);
  const [rot, setRot] = useState(0);

  const carried = state.items.filter((i) => i.ownerId === ownerId && i.at !== null);
  const holding = carried.find((i) => i.id === held) ?? null;
  if (held !== null && !holding) {
    // 使ったか落とした。持ち上げたままにしない
    setHeld(null);
  }

  /** 埋まっているマス → そこにあるアイテム */
  const occupied = new Map<string, ItemInstance>();
  for (const item of carried) {
    if (!item.at) continue;
    for (const [dx, dy] of rotated(itemDefOf(item.itemId).shape, item.rot)) {
      occupied.set(`${item.at.x + dx},${item.at.y + dy}`, item);
    }
  }

  /** 持ち上げているものを、その向きでそこに置けるか */
  const fits = (x: number, y: number): boolean => {
    if (!holding) return false;
    const shape = rotated(itemDefOf(holding.itemId).shape, rot);
    return shape.every(([dx, dy]) => {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= BAG_W || cy >= BAG_H) return false;
      const there = occupied.get(`${cx},${cy}`);
      return there === undefined || there.id === holding.id;
    });
  };

  const lift = (item: ItemInstance) => {
    if (!mine || !playing) return;
    if (held === item.id) {
      setHeld(null);
      return;
    }
    setHeld(item.id);
    setRot(item.rot);
  };

  const cells = [];
  for (let y = 0; y < BAG_H; y++) {
    for (let x = 0; x < BAG_W; x++) {
      const here = occupied.get(`${x},${y}`);
      const isHeld = here !== undefined && here.id === holding?.id;
      const canDrop = holding !== null && fits(x, y);

      cells.push(
        <button
          key={`${x},${y}`}
          /*
           * マスにも座標を持たせる。自動配置に任せると、
           * 上に重ねた絵（明示配置）を避けて流れ込み、行が勝手に増える。
           * 実測で 4 行のはずが 6 行になって、袋が縦に伸びていた。
           */
          style={{ gridColumn: x + 1, gridRow: y + 1 }}
          className={[
            'bag-cell',
            here ? 'full' : '',
            isHeld ? 'held' : '',
            canDrop ? 'drop-ok' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!mine || !playing}
          onClick={() => {
            if (holding && canDrop) {
              onMove(holding.id, x, y, rot);
              setHeld(null);
              return;
            }
            if (here) lift(here);
          }}
        />,
      );
    }
  }

  // アイテムの絵はマスの上に重ねる。1マスずつ切るとアイテムの形が読めない
  const pieces = carried.map((item) => {
    if (!item.at) return null;
    const def = itemDefOf(item.itemId);
    const [w, h] = shapeSize(rotated(def.shape, item.rot));
    const style: CSSProperties = {
      gridColumn: `${item.at.x + 1} / span ${w}`,
      gridRow: `${item.at.y + 1} / span ${h}`,
    };
    return (
      <span
        key={item.id}
        className={`bag-piece${item.id === holding?.id ? ' held' : ''}`}
        style={style}
      >
        <TileIcon id={def.sprite} size={32} />
      </span>
    );
  });

  const used = carried.reduce(
    (n, i) => n + itemDefOf(i.itemId).shape.length,
    0,
  );

  return (
    <div className="bag">
      <div className="bag-head">
        <span>
          {used} / {BAG_W * BAG_H} マス
        </span>
        {holding && (
          <span className="bag-hint">置きたいマスを押す</span>
        )}
      </div>

      <div
        className="bag-grid"
        /*
         * 行は指定しない。マス側の aspect-ratio:1 に高さを決めさせる。
         * 行を 1fr で割ると、中に置いた絵の大きさに引っ張られて
         * マスが縦に伸びた（実測 56px のはずが 88px になった）。
         * ミニマップでも同じ罠を踏んでいる（MiniMap.tsx）。
         */
        style={{ gridTemplateColumns: `repeat(${BAG_W}, minmax(0, 1fr))` }}
      >
        {cells}
        {pieces}
      </div>

      {carried.length === 0 && (
        <div className="inventory-empty">{mine ? '何も持っていない' : 'からっぽ'}</div>
      )}

      {/* 持ち上げたものへの操作。盤に重ならないよう袋の下に出す */}
      {holding && mine && playing && (
        <div className="bag-actions">
          <span className="bag-name">{itemDefOf(holding.itemId).name}</span>
          {shapeSize(itemDefOf(holding.itemId).shape)[0] !==
            shapeSize(itemDefOf(holding.itemId).shape)[1] && (
            <button onClick={() => setRot((r) => (r + 1) % 2)}>回す</button>
          )}
          <button onClick={() => onUse(holding.id)}>使う</button>
          <button onClick={() => onDrop(holding.id)}>置く</button>
        </div>
      )}
    </div>
  );
}
