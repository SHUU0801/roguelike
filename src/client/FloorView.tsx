import { useEffect, useState, type CSSProperties } from 'react';
import { itemDefOf } from '../shared/items';
import { dungeonOf } from '../shared/dungeons';
import { jobOf, type JobId } from '../shared/jobs';
import { speciesOf } from '../shared/monsters';
import {
  ANIMATED,
  FLIP_OFFSET,
  JOB_SHEET,
  POSE,
  PORTRAIT_ROW,
  SHEET,
  SPRITE_INDEX,
  TILE_SPRITE,
  WALKS,
  type SpriteId,
} from '../shared/sprites';
import {
  actorAt,
  dirTo,
  hasEffect,
  itemAt,
  seenAt,
  tileAt,
  visibleAt,
  type Dir,
  type GameState,
} from '../shared/types';
import type { Effect, TurnEffects } from './useTurnEffects';

/**
 * 見える範囲（マス数）。
 *
 * 9×13 で始めたが、375×667（iPhone SE / iPhone 8）で実測したら
 * 画面を 103px はみ出していた。ページがスクロールしてしまい、
 * 盤面をタップしようとした指がスクロールを起こして移動が空振りする。
 * 11 行なら収まる。設計書 §7 の「実機で確認してから確定する」の確定値。
 */
const VIEW_W = 9;
const VIEW_H = 11;

/**
 * スプライト1枚分の背景指定。
 *
 * ピクセル計算ではなく % で切り出す。マスの大きさが変わっても追従する。
 * 拡大でぼやけないのは CSS の image-rendering: pixelated に任せる。
 */
function spriteStyle(id: SpriteId): CSSProperties {
  const index = SPRITE_INDEX[id];
  const col = index % SHEET.cols;
  const row = Math.floor(index / SHEET.cols);
  const atCol = (c: number) => `${(c / Math.max(1, SHEET.cols - 1)) * 100}%`;

  const style: Record<string, string> = {
    backgroundImage: `url(${SHEET.url})`,
    backgroundSize: `${SHEET.cols * 100}% ${SHEET.rows * 100}%`,
    backgroundPosition: `${atCol(col)} ${(row / Math.max(1, SHEET.rows - 1)) * 100}%`,
  };

  // 2コマあるものは、切り替え先を CSS 変数で渡す。
  // 2コマ目はシート上の隣の枠なので、横位置だけ動かせばいい。
  if (ANIMATED.has(id)) {
    style['--fx0'] = atCol(col);
    style['--fx1'] = atCol(col + 1);
  }
  // 歩きのコマは待機の2つ先。待機（呼吸）とは別の絵を使う
  if (WALKS.has(id)) {
    style['--wx0'] = atCol(col + 2);
    style['--wx1'] = atCol(col + 3);
  }
  return style as CSSProperties;
}

/**
 * プレイヤーの姿。**盤のシートではなく、職業だけのシートから切り出す。**
 *
 * 床や敵は自分で描いた 16x16、プレイヤーは手で描いてもらった絵と、
 * 出どころが違う。1枚にまとめると、どちらかを描き直すたび
 * もう一方まで貼り直すことになるので、シートを分けてある。
 *
 * 切り出し方（% 指定）とコマの渡し方（--fx / --wx）は
 * spriteStyle と同じにしてある。CSS 側は区別せずに動かせる。
 */
function jobStyle(
  job: JobId | null,
  pose: number = POSE.idle,
  facing: Dir = 'e',
): CSSProperties {
  // 職業を選ぶ前の人も居る。jobOf と同じで、既定は戦士
  const row = PORTRAIT_ROW[job ?? 'warrior'];
  // 左を向いているときは反転した一式（シートの右半分）を使う
  const flip = facing === 'w' ? FLIP_OFFSET : 0;
  const atCol = (c: number) => `${((c + flip) / Math.max(1, JOB_SHEET.cols - 1)) * 100}%`;

  return {
    backgroundImage: `url(${JOB_SHEET.url})`,
    backgroundSize: `${JOB_SHEET.cols * 100}% ${JOB_SHEET.rows * 100}%`,
    backgroundPosition: `${atCol(pose)} ${(row / Math.max(1, JOB_SHEET.rows - 1)) * 100}%`,
    // 待機の呼吸は立ちの2枚を往復する
    '--fx0': atCol(POSE.idle),
    '--fx1': atCol(POSE.idle2),
    // 歩きは踏み込みのコマと立ちを往復する
    '--wx0': atCol(POSE.dash),
    '--wx1': atCol(POSE.idle),
  } as CSSProperties;
}

/** 動きの向きは CSS 変数で渡す。キーフレーム側がこれを掛けて使う */
function effectStyle(effect: Effect | undefined): CSSProperties {
  if (!effect || effect.kind === 'hit') return {};
  return { '--dx': effect.dx, '--dy': effect.dy } as CSSProperties;
}

/**
 * スプライトシートが読めたか。
 *
 * 読めなければ絵文字に戻す。素材を差し替える作業中に画面が真っ暗になると
 * 何が起きているか分からなくなるので、保険を残してある。
 */
function useSprites(): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onerror = () => setFailed(true);
    img.src = SHEET.url;
  }, []);
  return !failed;
}

type Props = {
  state: GameState;
  myId: string;
  turnEffects: TurnEffects;
  onMove: (dir: Dir) => void;
  /** 遠いマスを押したとき。そこまで歩く（travel.ts） */
  onTravel: (to: { x: number; y: number }) => void;
  /** 歩いている途中の道。目で追えるように印を出す */
  path: readonly { x: number; y: number }[];
};

/**
 * ダンジョンのマス目。
 *
 * Canvas を使わず CSS Grid で描く（設計書 §7）。
 * 要素として並べておけば、画面を見ながら「このマスがおかしい」と指差して直せる。
 *
 * マスは3段階で描き分ける:
 *   今見えている       … 地形 + Actor + アイテム
 *   見たことがある     … 地形だけ（暗く）
 *   見たことがない     … 真っ黒
 */
export function FloorView({ state, myId, turnEffects, onMove, onTravel, path }: Props) {
  const { floor } = state;
  const sprites = useSprites();
  // 地形の絵はダンジョンごとに違う。どこへ潜っても同じ絵だと、別の場所に来た気がしない
  const theme = dungeonOf(state.dungeon).theme;
  const me = state.actors.find((a) => a.id === myId);

  // 自キャラを常に中央に置く。端では盤外が映るが、盤外は真っ黒になるので問題ない
  const originX = (me ? me.pos.x : 0) - Math.floor(VIEW_W / 2);
  const originY = (me ? me.pos.y : 0) - Math.floor(VIEW_H / 2);

  const cells = [];
  for (let vy = 0; vy < VIEW_H; vy++) {
    for (let vx = 0; vx < VIEW_W; vx++) {
      const x = originX + vx;
      const y = originY + vy;

      const visible = visibleAt(floor, x, y);
      const remembered = !visible && seenAt(floor, x, y);
      const known = visible || remembered;
      const tile = tileAt(floor, x, y);

      const dir = me ? dirTo(me.pos, { x, y }) : null;
      const movable = dir !== null && tile !== 'wall' && known;
      /*
       * 隣でなくても、見たことがある床なら押せる。
       *
       * 隣しか押せないと、部屋の端まで行くのに十数回タップすることになる。
       * タッチで遊ばせるローグライクの定石（08_参考にしたもの.md）。
       */
      const reachable = !movable && known && tile !== 'wall' && me !== undefined;
      const onPath = path.some((p) => p.x === x && p.y === y);

      // 枠の色で見分ける。黄=自分 / 青=仲間 / 赤=敵。
      // 「赤いマスは叩ける」が色だけで伝わるので、説明文が要らない
      const occupant = visible ? actorAt(state, x, y) : undefined;
      const mark = !occupant
        ? ""
        : occupant.kind === "monster"
          ? "foe"
          : occupant.id === myId
            ? "me"
            : "ally";

      // 乗っているもの（Actor > アイテム）。記憶だけのマスには出さない
      const item = visible && !occupant ? itemAt(state, x, y) : undefined;
      /*
       * 上に乗っているものの絵。
       * プレイヤーだけ別のシート（職業シート）から取るので、
       * ここでは「盤のシートの絵」と「プレイヤー」を分けて持つ。
       */
      const isPlayer = occupant?.kind === 'player';
      const playerJob: JobId | null = isPlayer ? occupant.job : null;
      const topSprite: SpriteId | null =
        occupant && occupant.kind === 'monster'
          ? speciesOf(occupant.speciesId).sprite
          : !occupant && item
            ? itemDefOf(item.itemId).sprite
            : null;
      const hasTop = topSprite !== null || isPlayer;

      // 倒れた仲間。actorAt は生きているものしか返さないので別に探す。
      // どこで倒れたかが見えないと、起こしに行きようがない
      const fallen =
        visible && !occupant
          ? state.actors.find(
              (a) => a.kind === 'player' && !a.alive && a.pos.x === x && a.pos.y === y,
            )
          : undefined;

      const effect = occupant ? turnEffects.effects.get(occupant.id) : undefined;
      const ghost = turnEffects.ghosts.find((g) => g.pos.x === x && g.pos.y === y);

      cells.push(
        <div
          key={`${x},${y}`}
          className={[
            "cell",
            known ? tile : "unseen",
            remembered ? "dim" : "",
            movable ? "movable" : "",
            // 何も乗っていない行き先には点を出す。「ここを押せば歩く」が1秒で分かる
            movable && !hasTop ? "vacant" : "",
            reachable ? 'reachable' : '',
            onPath ? 'on-path' : '',
            mark,
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            sprites && known
              ? spriteStyle(
                  tile === 'wall' ? theme.wall : tile === 'floor' ? theme.floor : TILE_SPRITE[tile],
                )
              : undefined
          }
          onClick={
            movable && dir
              ? () => onMove(dir)
              : reachable
                ? () => onTravel({ x, y })
                : undefined
          }
        >
          {/*
            盤を寝かせてあるので、上に乗るものはここで起こす（.stand）。
            起こさないと人も床と一緒に潰れて、真上から見た絵に戻ってしまう。
            床の模様と敵の向きの印は寝たまま。あれは床に描いてあるもの。
          */}
          <span className="stand">
          {/* 倒れたものの残像。消えるアニメーションの間だけ出る */}
          {sprites && ghost && (
            <span
              key={`ghost-${ghost.id}`}
              className="sprite dying"
              style={spriteStyle(ghost.sprite)}
            />
          )}

          {sprites
            ? hasTop && (
                // key にターンを入れてあるのが肝。ターンごとに要素を作り直すので
                // 同じ種類のアニメーションでも毎回きちんと再生される
                <span
                  key={`${occupant?.id ?? 'item'}-${state.turn}`}
                  className={[
                    'sprite',
                    topSprite && ANIMATED.has(topSprite) ? 'anim' : '',
                    /*
                     * 手描きの絵は待機が2枚とも別の立ち方で、
                     * 入れ替えると息づかいではなく痙攣に見えた。
                     * プレイヤーの待機はコマを送らず、拡縮だけで生かす。
                     */
                    isPlayer ? 'job' : '',
                    occupant?.id === myId ? 'self' : '',
                    // 種族ごとに攻撃モーションを変えるための目印
                    occupant?.kind === 'monster' ? `s-${occupant.speciesId}` : '',
                    // まだ気づいていない敵は、ふわふわしているだけにする
                    occupant?.kind === 'monster' && !occupant.aware ? 'unaware' : '',
                    effect ? effect.kind : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    ...(isPlayer
                      ? // 殴りかかっているあいだだけ攻撃の絵にする
                        jobStyle(
                          playerJob,
                          effect?.kind === 'lunge' ? POSE.attack : POSE.idle,
                          occupant.facing,
                        )
                      : spriteStyle(topSprite as SpriteId)),
                    ...effectStyle(effect),
                  }}
                />
              )
            : glyphAt(state, x, y, visible, remembered)}

          {/* 倒れた仲間。薄く寝かせて描く */}
          {sprites && fallen && (
            <span
              className="sprite fallen"
              style={jobStyle(fallen.job, POSE.down, fallen.facing)}
            />
          )}

          {/* 誰が誰かの目印。全員が同じ見た目なので番号が要る */}
          {(occupant?.kind === 'player' || fallen) && (
            <span className="slot">{(occupant ?? fallen)?.slot}</span>
          )}

          </span>

          {/*
            敵の向きと状態。
            向きが見えないと「背後から忍び寄る」が運になる。
            向きを画面に出して初めて、回り込みが判断になる。
          */}
          {occupant?.kind === 'monster' && (
            <span
              className={`facing f-${occupant.facing}${occupant.aware ? ' awake' : ''}`}
            />
          )}
          {/* わざが当たったマス。わざごとに色と形が違う */}
          {occupant && turnEffects.skillHits?.ids.includes(occupant.id) && (
            <span
              key={`fx-${state.turn}`}
              className={`skillfx fx-${turnEffects.skillHits.skill}`}
            />
          )}

          {/* 気づいた瞬間だけ出す印。常設の札は増やさない（向きの色で足りる） */}
          {occupant?.kind === 'monster' && turnEffects.noticed.has(occupant.id) && (
            <span key={`n-${state.turn}`} className="notice" />
          )}
          {occupant?.kind === 'monster' && hasEffect(occupant, 'stun', state.turn) && (
            <span className="frozen" />
          )}
          {occupant?.kind === 'monster' && hasEffect(occupant, 'poison', state.turn) && (
            <span className="poisoned" />
          )}

          {/* 敵の残り体力。絵文字だけだと「あと何発で倒せるか」が分からない */}
          {occupant?.kind === 'monster' && (
            <span className="hpbar">
              <i
                style={{
                  width: `${Math.max(0, Math.min(100, (occupant.hp / occupant.maxHp) * 100))}%`,
                }}
              />
            </span>
          )}
        </div>,
      );
    }
  }

  /*
   * カメラ。
   *
   * 自キャラは常に画面の真ん中にいる。つまり**自分は画面の上で動いていない**。
   * なのに自分のスプライトにも移動アニメを掛けていたので、
   * 「自分が滑る」と「盤が瞬間移動する」が同時に起きて、
   * カメラが遅れて追いかけているように見えていた。
   *
   * 動かすのは盤のほう。1歩ぶん逆向きにずらした位置から 0 へ戻す。
   * 自分のスプライトは位置を動かさない（CSS 側で打ち消してある）。
   *
   * `turnEffects.turn === state.turn` で待つのは、効果の計算が
   * 1レンダー遅れて届くため。先に class を付けてしまうと、
   * 次のターンで class が変わらずアニメが再生されない。
   */
  const myMove = turnEffects.turn === state.turn ? turnEffects.effects.get(myId) : undefined;
  const pan = myMove?.kind === 'moved' ? myMove : null;

  const floorStyle = {
    gridTemplateColumns: `repeat(${VIEW_W}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${VIEW_H}, minmax(0, 1fr))`,
    // 盤そのものに縦横比を持たせる。横が狭ければ横に、縦が短ければ縦に合わせて縮む
    aspectRatio: `${VIEW_W} / ${VIEW_H}`,
    '--vw': VIEW_W,
    '--vh': VIEW_H,
    '--cdx': pan ? pan.dx : 0,
    '--cdy': pan ? pan.dy : 0,
    '--cw': `${100 / VIEW_W}%`,
    '--ch': `${100 / VIEW_H}%`,
  } as CSSProperties;

  return (
    // 外側で切る。盤が動く以上、動いている間ははみ出す。
    // 切らないとヘッダーやログの上に盤が乗る
    <div className="floor-wrap">
      <div className={pan ? 'floor panning' : 'floor'} style={floorStyle}>
        {cells}
      </div>
    </div>
  );
}

/**
 * スプライトシートが読めなかったときの絵文字。
 * 「見たことがあるだけ」のマスには、動くもの（Actor・アイテム）を出さない。
 */
function glyphAt(
  state: GameState,
  x: number,
  y: number,
  visible: boolean,
  remembered: boolean,
): string {
  if (visible) {
    const actor = actorAt(state, x, y);
    if (actor) return speciesOf(actor.speciesId).glyph;

    const item = itemAt(state, x, y);
    if (item) return itemDefOf(item.itemId).glyph;
  }

  if (!visible && !remembered) return '';

  return tileAt(state.floor, x, y) === 'stairs' ? '🔽' : '';
}
