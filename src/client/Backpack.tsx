import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { isUsable, itemDefOf, rotated, shapeSize } from '../shared/items';
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
 * ## ドラッグと、タップの両方で動かせる
 *
 * **指で掴んで引っ張れる。** 袋に物を詰める操作としてはこれが自然で、
 * 形のあるアイテムをどこに嵌めるかは、動かしながら決めたい。
 *
 * ドラッグを避けていた理由（スクロールと取り合う）は、
 * 袋に `touch-action: none` を置いて解決している。
 * 袋の上の指はスクロールに使われない。
 *
 * 指を動かさずに離したときは「持ち上げた」扱いにして、
 * 置きたいマスを押す形でも動かせる。狭い端末ではこちらのほうが確実なので、
 * **どちらでも動く**ようにしてある。
 *
 * 置ける場所は掴んでいる間だけ緑で示す。どこに入るか分からないまま総当たりさせない。
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
  /** 指で引っ張っている間の情報。離すまで置き先を決めない */
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

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

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  /** その向きでそこに置けるか */
  const fitsAt = (item: ItemInstance, at: { x: number; y: number }, r: number): boolean => {
    const shape = rotated(itemDefOf(item.itemId).shape, r);
    return shape.every(([dx, dy]) => {
      const cx = at.x + dx;
      const cy = at.y + dy;
      if (cx < 0 || cy < 0 || cx >= BAG_W || cy >= BAG_H) return false;
      const there = occupied.get(`${cx},${cy}`);
      return there === undefined || there.id === item.id;
    });
  };

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

  /** 指の位置から袋のマスを求める。掴んだ場所ではなく、いま指がある場所で判定する */
  const cellAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * BAG_W);
    const y = Math.floor(((clientY - r.top) / r.height) * BAG_H);
    if (x < 0 || y < 0 || x >= BAG_W || y >= BAG_H) return null;
    return { x, y };
  };

  const onPointerDown = (item: ItemInstance) => (e: PointerEvent<HTMLButtonElement>) => {
    if (!mine || !playing) return;
    /*
     * 掴みは袋（枠）側で受け取る。
     *
     * マス側で setPointerCapture すると、以降の移動と離しが**そのマスにだけ**届き、
     * 枠に付けた onPointerMove / onPointerUp が一度も呼ばれない。
     * 実際それで引っ張っても何も起きなかった。
     * 合成イベントでは capture が失敗することがあるので、落ちないようにしておく。
     */
    try {
      gridRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // 掴めなくても、枠の上を動かしている限りイベントは届く
    }
    /*
     * ここではまだ持ち上げない。
     *
     * 押した瞬間に持ち上げると、指を動かさずに離したとき（＝タップ）に
     * 続けて走る onClick が「持っているものを同じ場所に置く」と解釈して、
     * 何も起きずに終わる。実際それでタップ操作が死んでいた。
     * 指が動いてから持ち上げる。
     */
    dragRef.current = { id: item.id, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      // 動き始めた。ここで初めて持ち上げる
      drag.moved = true;
      const item = carried.find((i) => i.id === drag.id);
      setHeld(drag.id);
      setRot(item?.rot ?? 0);
      setDragging(true);
    }
    // 置ける場所の表示を更新するだけ。実際に動かすのは指を離したとき
    const at = cellAt(e.clientX, e.clientY);
    if (at) setHover(at);
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setHover(null);
    if (!drag) return;

    // 指を動かさずに離した＝タップ。持ち上げたままにして、置き先を押してもらう
    if (!drag.moved) return;

    const at = cellAt(e.clientX, e.clientY);
    if (!at) return;
    const item = carried.find((i) => i.id === drag.id);
    if (!item) return;
    if (!fitsAt(item, at, rot)) return;
    onMove(item.id, at.x, at.y, rot);
    setHeld(null);
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
      // 指の下に来ているマス。どこに落ちるかを強く出す
      const under =
        dragging && hover !== null && holding !== null && fitsAt(holding, hover, rot)
          ? rotated(itemDefOf(holding.itemId).shape, rot).some(
              ([dx, dy]) => hover.x + dx === x && hover.y + dy === y,
            )
          : false;

      cells.push(
        <button
          key={`${x},${y}`}
          onPointerDown={here ? onPointerDown(here) : undefined}
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
            under ? 'under' : '',
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
        ref={gridRef}
        className={`bag-grid${dragging ? ' dragging' : ''}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
          {/* 装備は使えない。袋に入れていることが効果そのもの */}
          {isUsable(holding.itemId) ? (
            <button onClick={() => onUse(holding.id)}>使う</button>
          ) : (
            <span className="equip-chip">
              {itemDefOf(holding.itemId).equip?.atk
                ? `攻${itemDefOf(holding.itemId).equip?.atk ?? 0 > 0 ? '+' : ''}${itemDefOf(holding.itemId).equip?.atk}`
                : ''}
              {itemDefOf(holding.itemId).equip?.def
                ? ` 防${(itemDefOf(holding.itemId).equip?.def ?? 0) > 0 ? '+' : ''}${itemDefOf(holding.itemId).equip?.def}`
                : ''}
            </span>
          )}
          <button onClick={() => onDrop(holding.id)}>置く</button>
        </div>
      )}
    </div>
  );
}
