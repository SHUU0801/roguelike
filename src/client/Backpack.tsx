import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
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
/**
 * 装備の補正を「攻+4 防-1」の形にする。
 *
 * 文字列の中で組み立てたら `攻${a ?? 0 > 0 ? '+' : ''}` と書いてしまい、
 * `?? (0 > 0)` と解釈されて「攻+-1」になった。外に出して素直に書く。
 */
function equipLabel(itemId: string): string {
  const e = itemDefOf(itemId).equip;
  if (!e) return '';
  const part = (name: string, v: number | undefined) =>
    v === undefined || v === 0 ? '' : `${name}${v > 0 ? '+' : ''}${v}`;
  return [part('攻', e.atk), part('防', e.def)].filter(Boolean).join(' ');
}

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
  const dragRef = useRef<{ id: string; moved: boolean; pointerId: number } | null>(null);
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
  /** 指そのものの位置。掴んでいる絵をここへ運ぶ */
  const [ptr, setPtr] = useState<{ x: number; y: number } | null>(null);

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
     * ここでは掴まない。持ち上げもしない。覚えるだけ。
     *
     * 押した瞬間に setPointerCapture すると、**そのあとの click が
     * マスではなく捕まえた側に飛ぶ**。クリックがマスに届かないので
     * アイテムが持ち上がらず、「使う」ボタンが出てこない。
     * 実機で「使うボタンが押せない」と言われたのはこれ。
     *
     * 持ち上げも同じ理由で遅らせる。押した瞬間に持ち上げると、
     * タップのときに続けて走る onClick が「同じ場所に置く」と解釈して何も起きない。
     *
     * どちらも「指が動いてから」（onPointerMove）に寄せてある。
     */
    dragRef.current = { id: item.id, moved: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      // 動き始めた。ここで初めて掴んで持ち上げる。
      // 掴むのは袋（枠）側。マス側で捕まえると、以降の移動と離しが
      // そのマスにだけ届き、枠のハンドラが呼ばれない
      drag.moved = true;
      try {
        gridRef.current?.setPointerCapture(drag.pointerId);
      } catch {
        // 捕まえられなくても、枠の上を動かしている限りイベントは届く
      }
      const item = carried.find((i) => i.id === drag.id);
      setHeld(drag.id);
      setRot(item?.rot ?? 0);
      setDragging(true);
    }
    // 置ける場所の表示を更新するだけ。実際に動かすのは指を離したとき
    setPtr({ x: e.clientX, y: e.clientY });
    const at = cellAt(e.clientX, e.clientY);
    if (at) setHover(at);
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      try {
        gridRef.current?.releasePointerCapture(drag.pointerId);
      } catch {
        // すでに外れている
      }
    }
    setDragging(false);
    setHover(null);
    setPtr(null);
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
        className={[
          'bag-piece',
          item.id === holding?.id ? 'held' : '',
          // 指に付いてくる絵のほうが本体になるので、元の場所は薄くする
          dragging && item.id === holding?.id ? 'ghosted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
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

      {/*
        指に付いてくる絵。
        掴んだ場所に絵が残ったままだと、何を持っているのか分からない。
        指のちょうど下に、本来の大きさ（マス数ぶん）で出す。

        **body に直接描く（portal）。**
        袋の枠は transform を持っているので、その中に position:fixed を置くと
        画面ではなく枠が基準になる。実際に縦へ 380px ずれた。
      */}
      {dragging &&
        holding &&
        ptr &&
        createPortal(
          <span
            className="drag-ghost"
            style={(() => {
            const grid = gridRef.current;
            const unit = grid ? grid.getBoundingClientRect().width / BAG_W : 48;
            const [w, h] = shapeSize(rotated(itemDefOf(holding.itemId).shape, rot));
              return {
                left: ptr.x - (unit * w) / 2,
                top: ptr.y - (unit * h) / 2,
                width: unit * w,
                height: unit * h,
              };
            })()}
          >
            <TileIcon id={itemDefOf(holding.itemId).sprite} size={32} />
          </span>,
          document.body,
        )}

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
            <span className="equip-chip">{equipLabel(holding.itemId)}</span>
          )}
          <button onClick={() => onDrop(holding.id)}>置く</button>
        </div>
      )}
    </div>
  );
}
