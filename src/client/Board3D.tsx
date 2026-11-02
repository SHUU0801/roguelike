import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { itemDefOf } from '../shared/items';
import { dungeonOf } from '../shared/dungeons';
import { speciesOf } from '../shared/monsters';
import {
  FLIP_OFFSET,
  JOB_SHEET,
  POSE,
  PORTRAIT_ROW,
  SHEET,
  SPRITE_INDEX,
  TILE_SPRITE,
  type SpriteId,
} from '../shared/sprites';
import {
  FUEL_START,
  dirTo,
  seenAt,
  tileAt,
  visibleAt,
  type Dir,
  type GameState,
} from '../shared/types';
import { DURATION, FX, fxAt, motionAt, type FxShape, type MotionKind, type Swing } from './motion';
import type { TurnEffects } from './useTurnEffects';

/**
 * ダンジョンの盤を three.js で描く。
 *
 * ## なぜ Canvas にしたか
 *
 * 設計書では「Canvas を使わない」としていた（要素を目で見て直せるから）。
 * それを覆したのは、CSS では**松明を光にできなかった**から。
 * 松明はこのゲームの芯の仕掛け（時間を資源にする）なのに、
 * CSS では「暗いクラス」でしかなく、燃料が 260 でも 50 でも画面は同じだった。
 * ここでは点光源にして、燃料が減るほど闇が寄ってくる。
 *
 * ついでに、CSS で詰まっていた2つも仕組みとして解けた:
 *   等角にするとキャラが豆粒になる → マスより大きい板を置けばいい
 *   手前のキャラが奥を隠さない     → 深度バッファがやる
 *
 * ## 作りの約束
 *
 * **ゲームの状態は一切持たない。** `state` を受け取って見た目に直すだけ。
 * サーバーが唯一の正しい状態という約束は変えない。
 *
 * **座標はワールド固定。** マスは常に (x, 0, y) に置き、カメラのほうが動く。
 * 最初はプレイヤー中心の相対座標で組んでいたが、そうすると
 * 1歩ごとに全部が建て直されて、滑らかに動かす余地が無かった。
 *
 * **動きはサーバーに持たせない。** 前の状態との差分（useTurnEffects）から
 * クライアントが決める。04_絵とアニメの方針.md §3-4 のまま。
 *
 * 盤だけ three.js で、ヘッダー・ログ・行動ボタン・持ち物は DOM のまま。
 * 文字と押しやすさは DOM のほうが強い。
 */

/** 画面に収めるマス数。等角は正方形より幅を食うので CSS 版より狭い */
const VIEW = 9;

/** カメラの角度。寝かせ具合と回り込み */
const CAM_TILT = Math.PI / 4.4;
const CAM_YAW = Math.PI / 4;
const CAM_DIST = 30;

/** 壁の高さ。高くすると手前の壁が人を隠す */
const WALL_H = 0.55;


type Props = {
  state: GameState;
  myId: string;
  turnEffects: TurnEffects;
  onMove: (dir: Dir) => void;
  onTravel: (to: { x: number; y: number }) => void;
  path: readonly { x: number; y: number }[];
};

/** 1枚の板に付ける動き。描画ループが毎フレーム読む */
type Anim = {
  kind: MotionKind;
  dx: number;
  dy: number;
  /** 殴り方。種族で変える */
  swing: Swing;
  /** 殴り返されたか。振りに白飛びを重ねる */
  hurt: boolean;
  start: number;
};

/**
 * 足元の影の絵。中心が濃く、外へ向かって消える円。
 *
 * ただの円を敷いたら、縁がくっきり出て「黒い紙を置いた」ように見えた。
 * にじませると地面に馴染む。絵の数を増やしたくないので、
 * 画像ファイルではなく**その場で描いて**1枚だけ作る。
 */
function makeBlob(): THREE.Texture {
  const n = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * わざの演出の絵。3つだけ、その場で描く。
 *
 *   slash … 斜めの白い筋
 *   burst … 中心から外へ薄れる円
 *   ring  … 輪っか
 *
 * わざ12種類ぶんの絵は作らない。形3つに色を掛ければ足りる。
 * 色は materialで付けるので、絵は白黒でいい。
 */
function makeFx(shape: FxShape): THREE.Texture {
  const n = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;

  if (shape === 'slash') {
    g.translate(n / 2, n / 2);
    g.rotate(-0.73);
    const grad = g.createLinearGradient(0, -n / 2, 0, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.46, 'rgba(255,255,255,1)');
    grad.addColorStop(0.54, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(-n, -n / 2, n * 2, n);
  } else if (shape === 'ring') {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(n / 2, n / 2, n / 2 - 4, 0, Math.PI * 2);
    g.stroke();
  } else {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadSheet(url: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * シートの1枠だけを映すテクスチャ。
 * `repeat` と `offset` で切り出す。大もとを共有すると offset も共有されるので
 * 枠ごとに clone する（clone しても画像は1枚しか読まれない）。
 */
function frameOf(sheet: THREE.Texture, cols: number, rows: number, col: number, row: number) {
  const t = sheet.clone();
  t.needsUpdate = true;
  t.repeat.set(1 / cols, 1 / rows);
  // three の UV は下が 0。シートは上から数えるので裏返す
  t.offset.set(col / cols, 1 - (row + 1) / rows);
  return t;
}


/**
 * 向きから、どの絵をどちら向きで出すか決める。
 *
 * カメラは南東から見下ろしている。だから盤の方角は画面でこう見える:
 *
 *   北へ進む → カメラから遠ざかる → **後ろ姿**
 *   南へ進む → カメラへ近づく     → **正面**
 *   東へ進む → 画面の右奥へ       → 横向き（そのまま）
 *   西へ進む → 画面の左手前へ     → 横向き（反転）
 *
 * もらった絵に前・後ろ・横が揃っているので、板1枚でも向きが出る。
 * 絵が無い向きを無理に作らない——足りないぶんは一番近い絵で済ませる。
 */
function poseFor(facing: Dir, attacking: boolean): { pose: number; flip: boolean } {
  if (attacking) return { pose: POSE.attack, flip: facing === 'w' };
  switch (facing) {
    case 'n':
      return { pose: POSE.back, flip: false };
    case 's':
      return { pose: POSE.idle, flip: false };
    case 'w':
      return { pose: POSE.dash, flip: true };
    default:
      return { pose: POSE.dash, flip: false };
  }
}


/**
 * 歩いている間に送るコマ。
 *
 * 滑らせるだけだと、足が動かないので「進んでいる」ではなく
 * 「滑っている」に見える。1歩のあいだに2コマ送る。
 *
 * 横向きは踏み込み（dash）と立ち（idle）で足の位置が違うので、
 * その2枚を交互に出せば歩いて見える。
 *
 * **前と後ろには歩きのコマが無い。** もらった絵は正面・後ろとも1枚きり。
 * そこは左右反転を交互に出して体重の移動に見せる。
 * 外套や武器が左右に揺れるので、止まって見えるよりはずっといい。
 */
/** 種族ごとの殴り方。2D 版（CSS の s-goblin / s-bat / s-slime）と揃える */
function swingOf(speciesId: string | undefined): Swing {
  if (speciesId === 'bat') return 'bite';
  if (speciesId === 'slime') return 'squish';
  return 'slam';
}

function walkFrames(facing: Dir): [{ pose: number; flip: boolean }, { pose: number; flip: boolean }] {
  if (facing === 'e') return [{ pose: POSE.dash, flip: false }, { pose: POSE.idle, flip: false }];
  if (facing === 'w') return [{ pose: POSE.dash, flip: true }, { pose: POSE.idle, flip: true }];
  const pose = facing === 'n' ? POSE.back : POSE.idle;
  return [{ pose, flip: false }, { pose, flip: true }];
}

export function Board3D({ state, myId, turnEffects, onMove, onTravel, path }: Props) {
  const host = useRef<HTMLDivElement | null>(null);

  const kit = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    torch: THREE.PointLight;
    ground: THREE.Group;
    things: THREE.Group;
    tiles: THREE.Texture;
    jobs: THREE.Texture;
    frames: Map<string, THREE.Texture>;
    blob: THREE.Texture;
    /** 自キャラの板。カメラがこれを追う */
    hero: THREE.Object3D | null;
    fx: Record<FxShape, THREE.Texture>;
    /** カメラが向かう先。毎フレーム近づける */
    look: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);

  /*
   * 動きの始まった時刻。**ターンごとに1回だけ決める。**
   *
   * 建て直しのたびに performance.now() を入れていたら、
   * React が再描画するたびに動きが振り出しに戻り、
   * **歩きのコマが1枚目から進まなかった**（足が動かない原因）。
   * 動きはターンに属するもので、再描画の回数とは関係ない。
   */
  const beat = useRef({ turn: -1, at: 0 });

  /** 最新の値をイベントハンドラと描画ループから読むための箱 */
  const live = useRef({ state, myId, onMove, onTravel });
  live.current = { state, myId, onMove, onTravel };

  // ── 組み立て。1回だけ ───────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      /*
       * 開発中だけ、描いた中身を後から読めるようにしておく。
       * これが無いと canvas を読んでも空か前のコマが返り、
       * **コマが変わったかどうかを画素で確かめられない。**
       * 本番では切る（毎コマ保持するのは無駄なので）。
       */
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    /*
     * 影を落とす。**これがキャラを「立体に見せる」一番の要素。**
     *
     * 参考にした絵のキャラも板（2Dのドット絵）だが、
     * 足元に影があって、同じ光で照らされているから世界に馴染んで見える。
     * 板を多角形にしても、影が無ければ貼り紙のままになる。
     */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';

    const scene = new THREE.Scene();

    /*
     * 正射影カメラ。遠近を付けない。
     * 付けると奥のマスが小さくなって、同じ広さの部屋が歪んで見える。
     * 等角のゲームが正射影なのはこのため。
     */
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    scene.add(camera);

    const torch = new THREE.PointLight(0xffd9a0, 9, 11, 1.1);
    torch.castShadow = true;
    torch.shadow.mapSize.set(1024, 1024);
    torch.shadow.bias = -0.005;
    scene.add(torch);

    // 形が分かる最低限だけ。明るさは松明に持たせる
    scene.add(new THREE.AmbientLight(0x3f4a5c, 0.55));
    const sky = new THREE.DirectionalLight(0x8296b4, 0.28);
    sky.position.set(-3, 8, -2);
    scene.add(sky);

    const ground = new THREE.Group();
    const things = new THREE.Group();
    scene.add(ground, things);

    const mine = {
      renderer,
      scene,
      camera,
      torch,
      ground,
      things,
      tiles: loadSheet(SHEET.url),
      jobs: loadSheet(JOB_SHEET.url),
      frames: new Map(),
      blob: makeBlob(),
      hero: null,
      fx: { slash: makeFx('slash'), burst: makeFx('burst'), ring: makeFx('ring') },
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
    };
    kit.current = mine;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      // 画面の短いほうに VIEW マスが収まるようにする
      const unit = Math.min(w, h) / VIEW;
      camera.left = -w / 2 / unit;
      camera.right = w / 2 / unit;
      camera.top = h / 2 / unit;
      camera.bottom = -h / 2 / unit;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);


    // 開発中だけ、中身を覗けるようにしておく（画面から調べる手段が無いので）
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__b3d = kit;

    return () => {
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      // 自分がまだ現役のときだけ片付ける。新しい側を巻き込まない
      if (kit.current === mine) kit.current = null;
    };
  }, []);


  /*
   * 描画ループ。**何も持たない別の effect にしてある。**
   *
   * 組み立てと同じ effect に入れていたとき、開発中の二重マウントで
   * ループと場面がちぐはぐになった。画面には絵が出ているのに
   * renderer は1コマしか描いておらず、動きが1つも効かない——
   * ループが古い側を、板を建てるのは新しい側を見ていた。
   *
   * ループが自前の道具を一切持たず、毎コマ ref から現役の一式を読めば、
   * どちらを見ているか迷いようがない。
   */
  useEffect(() => {
    const eye = new THREE.Vector3(
      Math.sin(CAM_YAW) * CAM_DIST,
      Math.tan(CAM_TILT) * CAM_DIST,
      Math.cos(CAM_YAW) * CAM_DIST,
    );
    /**
     * 1コマ描く。**時刻を引数でもらう。**
     *
     * ここを `performance.now()` から切り離してあるのが肝。
     * 確認に使うブラウザのペインが隠れていると rAF が呼ばれず、
     * 画面が止まって**動きを目で確かめる手段が無くなる。**
     * 時刻を外から渡せれば、止まった状態でも
     * 「踏み込みの 0.3 秒目」を名指しで描かせて見られる。
     */
    const frame = (now: number) => {
      const k = kit.current;
      if (!k) return;

      for (const o of k.things.children) {
        const base = o.userData.base as THREE.Vector3 | undefined;
        if (!base) continue;

        // わざの演出。板ではなく光なので、別扱いで進める
        const fx = o.userData.fx as
          | { shape: FxShape; life: number; start: number }
          | undefined;
        if (fx) {
          const ft = (now - fx.start) / fx.life;
          const g2 = fxAt(fx.shape, ft);
          const fm = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
          fm.opacity = Math.max(0, g2.fade);
          o.scale.set(g2.scale, g2.scale, 1);
          o.rotation.z = g2.spin;
          continue;
        }

        const a = o.userData.anim as Anim | undefined;
        o.position.copy(base);
        if (o.userData.flat !== true) {
          o.rotation.z = 0;
          o.scale.set(1, 1, 1);
        }
        /*
         * 影は MeshBasicMaterial で emissive を持たない。
         * 区別せずに触ると落ちるので、持っているものだけ触る。
         */
        const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial;
        const glow = (v: number) => mat.emissive?.setScalar(v);
        const flat = o.userData.flat === true;
        const solid = flat ? 0.55 : 1;
        /** 歩きの途中で動かした切り出し位置を元へ戻す */
        const settle = () => {
          const w = o.userData.walk as { rest: number } | undefined;
          if (w && mat.map) mat.map.offset.x = w.rest;
        };
        if (!a) {
          mat.opacity = solid;
          glow(0);
          settle();
          continue;
        }

        const t = (now - a.start) / DURATION[a.kind];
        const mv = motionAt(a.kind, t, a.dx, a.dy, a.swing);
        if (mv.done) {
          delete o.userData.anim;
          mat.opacity = solid;
          glow(0);
          settle();
          continue;
        }

        o.position.x += mv.dx;
        o.position.z += mv.dz;
        o.position.y += mv.dy;
        if (!flat) o.rotation.z = mv.spin;
        mat.opacity = solid * mv.fade;
        /*
         * 殴り返されたときは、振りに白飛びを重ねる。
         * 以前は被弾を優先して振りを捨てていたので、
         * 隣の敵と殴り合うと自分の振りが一度も見えなかった。
         */
        glow(a.hurt ? Math.max(mv.glow, Math.max(0, 0.9 - t * 3)) : mv.glow);
        if (!flat) o.scale.set(mv.sx, mv.sy, 1);

        /*
         * 足のコマ。**map を差し替えてはいけない。**
         * 差し替えるとシェーダが組み直されて重い。切り出し位置だけ動かす。
         */
        const w = o.userData.walk as { cols: [number, number]; total: number } | undefined;
        if ((a.kind === 'moved' || a.kind === 'lunge') && w && mat.map) {
          mat.map.offset.x = w.cols[mv.step] / w.total;
        }
      }

      /*
       * カメラは**自キャラの「いま描かれている位置」そのもの**を見る。
       *
       * 以前は目標（マスの座標）へ指数で寄せていた。
       * そうすると、キャラは 0.32 秒の直線で滑り、カメラは別の曲線で寄る。
       * **2つの違う動きの差が画面上の動きになる**ので、
       * 歩くたびにキャラが画面の中で前後にずれ、ぎこちなく見えた。
       *
       * キャラの位置をそのまま見れば、キャラは画面の真ん中に貼り付き、
       * 動くのは世界のほうになる。2D 版（CSS）もそうなっていた——
       * 歩きとカメラ送りが同じ 0.32 秒・同じ linear だったので、
       * たまたま一致していた。
       */
      if (k.hero) {
        k.look.set(k.hero.position.x, 0, k.hero.position.z);
        k.camera.position.copy(k.look).add(eye);
        k.camera.lookAt(k.look);
      }

      k.renderer.render(k.scene, k.camera);
    };

    let stop = false;
    const tick = () => {
      if (stop) return;
      requestAnimationFrame(tick);
      frame(performance.now() / 1000);
    };
    tick();

    /*
     * 開発中だけ、好きな時刻のコマを描かせる口を開けておく。
     * これが無いと、ペインが隠れている間は動きを見る手段が無い。
     */
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__b3dFrame = frame;
    }

    return () => {
      stop = true;
    };
  }, []);

  // ── 盤面を state に合わせて建て直す ────────────────
  useEffect(() => {
    const k = kit.current;
    if (!k) return;

    const me = state.actors.find((a) => a.id === myId);
    const floor = state.floor;
    const theme = dungeonOf(state.dungeon).theme;
    if (beat.current.turn !== state.turn) {
      beat.current = { turn: state.turn, at: performance.now() / 1000 };
    }
    const now = beat.current.at;

    const frame = (sheet: THREE.Texture, cols: number, rows: number, c: number, r: number) => {
      const key = `${sheet.uuid}:${c},${r}`;
      let t = k.frames.get(key);
      if (!t) {
        t = frameOf(sheet, cols, rows, c, r);
        k.frames.set(key, t);
      }
      return t;
    };
    const tileTex = (id: SpriteId) => {
      const i = SPRITE_INDEX[id];
      return frame(k.tiles, SHEET.cols, SHEET.rows, i % SHEET.cols, Math.floor(i / SHEET.cols));
    };

    const clear = (g: THREE.Group) => {
      for (const child of [...g.children]) {
        g.remove(child);
        (child as THREE.Mesh).geometry?.dispose();
      }
    };
    clear(k.ground);
    clear(k.things);
    k.hero = null;

    const cx = me ? me.pos.x : Math.floor(floor.width / 2);
    const cy = me ? me.pos.y : Math.floor(floor.height / 2);
    const half = VIEW;
    const onPath = new Set(path.map((p) => `${p.x},${p.y}`));

    for (let y = cy - half; y <= cy + half; y++) {
      for (let x = cx - half; x <= cx + half; x++) {
        const tile = tileAt(floor, x, y);
        const visible = visibleAt(floor, x, y);
        if (!visible && !seenAt(floor, x, y)) continue;

        if (tile === 'wall') {
          /*
           * 壁は箱。CSS では擬似要素で手前の面を1枚立てるしかなかったが、
           * ここでは本当に立体なので、回り込んでも破綻しない。
           * 高さを抑えてあるのは、高いと手前の壁が人を隠すため。
           */
          const mat = new THREE.MeshLambertMaterial({ map: tileTex(theme.wall) });
          if (!visible) mat.color.setScalar(0.45);
          const box = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_H, 1), mat);
          box.position.set(x, WALL_H / 2, y);
          box.castShadow = true;
          box.receiveShadow = true;
          k.ground.add(box);
          continue;
        }

        const mat = new THREE.MeshLambertMaterial({
          map: tileTex(tile === 'floor' ? theme.floor : TILE_SPRITE[tile]),
        });
        if (!visible) mat.color.setScalar(0.45); // 記憶だけのマスは沈める
        if (onPath.has(`${x},${y}`)) mat.emissive.setHex(0x1c3a2a);

        const cell = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(x, 0, y);
        cell.receiveShadow = true;
        cell.userData = { x, y };
        k.ground.add(cell);
      }
    }

    /** 画面に正対させる。カメラは固定なので向きを写すだけでいい */
    const face = (m: THREE.Object3D) => m.rotation.set(-CAM_TILT, CAM_YAW, 0, 'YXZ');

    /**
     * 足元の影。
     *
     * **板を地面に馴染ませる一番安い手。**
     * 落ち影（castShadow）だけだと、光の角度によっては影が伸びすぎたり
     * 消えたりして、浮いて見える瞬間が出る。
     * 真下に薄い楕円を敷いておくと、どの角度でも接地して見える。
     */
    const shadowFor = (x: number, y: number, size: number) => {
      const mat = new THREE.MeshBasicMaterial({
        map: k.blob,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.62), mat);
      m.rotation.x = -Math.PI / 2;
      // 床と同じ高さだと z ファイティングで散らつく。わずかに浮かせる
      m.position.set(x, 0.012, y);
      m.userData.base = m.position.clone();
      k.things.add(m);
      return m;
    };

    const put = (tex: THREE.Texture, size: number, x: number, y: number, lift: number) => {
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.3,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      m.position.set(x, lift, y);
      m.castShadow = true;
      m.userData.base = m.position.clone();
      face(m);
      k.things.add(m);
      return m;
    };

    for (const item of state.items) {
      if (!item.pos || !visibleAt(floor, item.pos.x, item.pos.y)) continue;
      shadowFor(item.pos.x, item.pos.y, 0.75);
      put(tileTex(itemDefOf(item.itemId).sprite), 0.8, item.pos.x, item.pos.y, 0.4);
    }

    for (const a of state.actors) {
      if (!visibleAt(floor, a.pos.x, a.pos.y)) continue;
      if (!a.alive && a.kind === 'monster') continue;

      let tex: THREE.Texture;
      /** 歩いている間に送るコマの列番号。描画ループが offset を動かす */
      let walk: [number, number] | null = null;

      if (a.kind === 'player') {
        const row = PORTRAIT_ROW[a.job ?? 'warrior'];
        const attacking = turnEffects.effects.get(a.id)?.kind === 'lunge';
        const look = a.alive
          ? poseFor(a.facing, attacking)
          : { pose: POSE.down, flip: a.facing === 'w' };
        const col = (p: { pose: number; flip: boolean }) =>
          p.pose + (p.flip ? FLIP_OFFSET : 0);

        /*
         * **板ごとに自前のテクスチャを持つ。**
         * 共有しているものの offset を動かすと、同じ絵を使う全員が一緒に動く。
         * 切り出し位置を毎コマ変えたいので、ここだけ clone する。
         */
        tex = k.jobs.clone();
        tex.needsUpdate = true;
        tex.repeat.set(1 / JOB_SHEET.cols, 1 / JOB_SHEET.rows);
        tex.offset.set(
          col(look) / JOB_SHEET.cols,
          1 - (row + 1) / JOB_SHEET.rows,
        );
        if (a.alive) {
          if (attacking) {
            /*
             * 振りかぶり → 振り抜き。
             * 構えの絵（guard）から斬る絵（attack）へ送ると、
             * 同じ踏み込みでも「振った」に見える。
             */
            const flip = a.facing === 'w';
            walk = [
              POSE.guard + (flip ? FLIP_OFFSET : 0),
              POSE.attack + (flip ? FLIP_OFFSET : 0),
            ];
          } else {
            const [f0, f1] = walkFrames(a.facing);
            walk = [col(f0), col(f1)];
          }
        }
      } else {
        tex = tileTex(speciesOf(a.speciesId).sprite);
      }

      /*
       * **マス1枚より大きく描く。**
       * 等角にするとマスの見かけの面積が小さく、人をマスに収めると豆粒になる。
       * 足元をマスに合わせたまま上へ伸ばす。
       */
      const h = a.kind === 'player' ? 1.7 : 1.2;
      /*
       * 足が地面に着くように置く。
       * 板の中心は h/2 の高さだが、絵の下には余白があるので少し沈める。
       */
      const feet = h / 2 - 0.12;
      const shade = shadowFor(a.pos.x, a.pos.y, h * 0.8);
      const m = put(tex, h, a.pos.x, a.pos.y, feet);
      if (a.id === myId) k.hero = m;
      if (walk) {
        // 歩き終わったら戻す位置も覚えておく。戻さないと踏み出した足のまま止まる
        m.userData.walk = {
          cols: walk,
          total: JOB_SHEET.cols,
          rest: tex.offset.x,
        };
      }

      const fx = turnEffects.effects.get(a.id);
      if (fx) {
        const anim = {
          kind: fx.kind,
          dx: 'dx' in fx ? fx.dx : 0,
          dy: 'dy' in fx ? fx.dy : 0,
          swing: a.kind === 'monster' ? swingOf(a.speciesId) : 'slam',
          hurt: fx.kind === 'lunge' && fx.hurt === true,
          start: now,
        } satisfies Anim;
        m.userData.anim = anim;
        // 影も一緒に動かす。置いていかれると足から影が剥がれる
        shade.userData.anim = { ...anim };
        shade.userData.flat = true;
      }
    }

    /*
     * わざの演出。当たったマスの上に1枚立てる。
     * 誰が撃ったかはサーバーに持たせていないので、
     * 当たった相手（skillHits）の足元に出す。
     */
    const hit = turnEffects.skillHits;
    if (hit) {
      const look = FX[hit.skill];
      if (look) {
        for (const id of hit.ids) {
          const who = state.actors.find((x) => x.id === id);
          if (!who || !visibleAt(floor, who.pos.x, who.pos.y)) continue;
          const mat = new THREE.MeshBasicMaterial({
            map: k.fx[look.shape],
            color: look.color,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat);
          m.position.set(who.pos.x, 0.6, who.pos.y);
          m.userData.base = m.position.clone();
          m.userData.fx = { shape: look.shape, life: look.life, start: now };
          face(m);
          k.things.add(m);
        }
      }
    }

    // 消えたものの残像。消えるあいだだけ出す
    for (const g of turnEffects.ghosts) {
      const m = put(tileTex(g.sprite), 1.2, g.pos.x, g.pos.y, 0.5);
      m.userData.anim = {
        kind: 'die',
        dx: 0,
        dy: 0,
        swing: 'slam',
        hurt: false,
        start: now,
      } satisfies Anim;
      (m.material as THREE.MeshLambertMaterial).transparent = true;
    }

    // カメラと松明を自分へ
    k.target.set(cx, 0, cy);
    // 自キャラが見えないとき（倒れた直後など）はマスの座標を見る
    if (!k.hero) {
      k.look.copy(k.target);
      k.camera.position.copy(k.look).add(
        new THREE.Vector3(
          Math.sin(CAM_YAW) * CAM_DIST,
          Math.tan(CAM_TILT) * CAM_DIST,
          Math.cos(CAM_YAW) * CAM_DIST,
        ),
      );
      k.camera.lookAt(k.look);
    }
    const fuel = me ? Math.max(0, Math.min(1, me.fuel / FUEL_START)) : 0;
    k.torch.position.set(cx, 1.5, cy);
    /*
     * 明るさは「読める」と「潜っている」の綱引き。
     * 環境光を上げたら床が白っぽくなって洞窟に見えなくなった。
     * 環境光は形が分かる最低限にして、**明るさは松明に持たせる。**
     */
    k.torch.distance = 3 + fuel * 7;
    k.torch.intensity = 5 + fuel * 9;
  }, [state, myId, path, turnEffects]);

  // ── タップ。レイキャストで床を拾う ─────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const ray = new THREE.Raycaster();
    const pt = new THREE.Vector2();

    const onUp = (e: PointerEvent) => {
      const k = kit.current;
      if (!k) return;
      const r = el.getBoundingClientRect();
      pt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(pt, k.camera);
      const hit = ray
        .intersectObjects(k.ground.children, false)
        .find((h) => h.object.userData.x !== undefined);
      if (!hit) return;

      const { x, y } = hit.object.userData as { x: number; y: number };
      const { state: s, myId: id, onMove: move, onTravel: travel } = live.current;
      const self = s.actors.find((a) => a.id === id);
      if (!self) return;

      // 隣なら1歩、遠ければそこまで歩く。2D 版と同じ決まり
      const dir = dirTo(self.pos, { x, y });
      if (dir) move(dir);
      else travel({ x, y });
    };

    el.addEventListener('pointerup', onUp);
    return () => el.removeEventListener('pointerup', onUp);
  }, []);

  return <div className="board3d" ref={host} />;
}
