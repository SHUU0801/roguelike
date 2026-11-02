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

/** 動きの長さ（秒）。CSS 版と揃える */
const T_MOVE = 0.32;
const T_LUNGE = 0.3;
const T_HIT = 0.36;
const T_DIE = 0.45;

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
  kind: 'moved' | 'lunge' | 'hit' | 'die';
  dx: number;
  dy: number;
  start: number;
};

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
    /** カメラが向かう先。毎フレーム近づける */
    look: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);

  /** 最新の値をイベントハンドラと描画ループから読むための箱 */
  const live = useRef({ state, myId, onMove, onTravel });
  live.current = { state, myId, onMove, onTravel };

  // ── 組み立て。1回だけ ───────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
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
    scene.add(torch);

    // 形が分かる最低限だけ。明るさは松明に持たせる
    scene.add(new THREE.AmbientLight(0x3f4a5c, 0.55));
    const sky = new THREE.DirectionalLight(0x8296b4, 0.28);
    sky.position.set(-3, 8, -2);
    scene.add(sky);

    const ground = new THREE.Group();
    const things = new THREE.Group();
    scene.add(ground, things);

    kit.current = {
      renderer,
      scene,
      camera,
      torch,
      ground,
      things,
      tiles: loadSheet(SHEET.url),
      jobs: loadSheet(JOB_SHEET.url),
      frames: new Map(),
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
    };

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

    const eye = new THREE.Vector3(
      Math.sin(CAM_YAW) * CAM_DIST,
      Math.tan(CAM_TILT) * CAM_DIST,
      Math.cos(CAM_YAW) * CAM_DIST,
    );
    const look = kit.current.look;
    const target = kit.current.target;

    // 開発中だけ、中身を覗けるようにしておく（画面から調べる手段が無いので）
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__b3d = kit;

    /*
     * 描画ループ。
     *
     * **ここで kit.current を見てはいけない。**
     * 最初そう書いたら、開発中の二重マウント（StrictMode）で
     * 一瞬 null になった拍子に `return` して、**次のコマを予約せずに止まった。**
     * 10 コマで固まって、カメラが初期位置のまま動かなくなる。
     * ループは自分の変数だけを見て、終わりは旗で知る。
     */
    let alive = true;
    const loop = () => {
      if (!alive) return;
      requestAnimationFrame(loop);

      // カメラを目標へ近づける。瞬間移動させると1歩ごとに画面が飛ぶ。
      // 指数で寄せると、止まるときに自然に減速する
      look.lerp(target, 0.18);
      camera.position.copy(look).add(eye);
      camera.lookAt(look);

      const now = performance.now() / 1000;
      for (const o of things.children) {
        const a = o.userData.anim as Anim | undefined;
        const base = o.userData.base as THREE.Vector3 | undefined;
        if (!base) continue;
        o.position.copy(base);
        o.rotation.z = 0;
        const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial;
        if (!a) {
          mat.opacity = 1;
          mat.emissive.setScalar(0);
          continue;
        }

        const dur =
          a.kind === 'moved' ? T_MOVE
          : a.kind === 'lunge' ? T_LUNGE
          : a.kind === 'hit' ? T_HIT
          : T_DIE;
        const t = (now - a.start) / dur;
        if (t >= 1) {
          delete o.userData.anim;
          mat.opacity = 1;
          mat.emissive.setScalar(0);
          continue;
        }

        if (a.kind === 'moved') {
          // 元いた方向から滑り込む
          const back = 1 - t;
          o.position.x -= a.dx * back;
          o.position.z -= a.dy * back;
        } else if (a.kind === 'lunge') {
          // 行って帰る。山なりにすると「突いた」感じになる
          const out = Math.sin(t * Math.PI) * 0.4;
          o.position.x += a.dx * out;
          o.position.z += a.dy * out;
        } else if (a.kind === 'hit') {
          o.position.x += Math.sin(t * Math.PI * 6) * 0.12;
          mat.emissive.setScalar(Math.max(0, 0.9 - t * 3)); // 一瞬白く飛ばす
        } else {
          // 回って沈んで消える
          o.position.y -= t * 0.5;
          o.rotation.z = t * 1.2;
          mat.opacity = 1 - t;
        }
      }

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      alive = false;
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      kit.current = null;
    };
  }, []);

  // ── 盤面を state に合わせて建て直す ────────────────
  useEffect(() => {
    const k = kit.current;
    if (!k) return;

    const me = state.actors.find((a) => a.id === myId);
    const floor = state.floor;
    const theme = dungeonOf(state.dungeon).theme;
    const now = performance.now() / 1000;

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
        cell.userData = { x, y };
        k.ground.add(cell);
      }
    }

    /** 画面に正対させる。カメラは固定なので向きを写すだけでいい */
    const face = (m: THREE.Object3D) => m.rotation.set(-CAM_TILT, CAM_YAW, 0, 'YXZ');

    const put = (tex: THREE.Texture, size: number, x: number, y: number, lift: number) => {
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.3,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      m.position.set(x, lift, y);
      m.userData.base = m.position.clone();
      face(m);
      k.things.add(m);
      return m;
    };

    for (const item of state.items) {
      if (!item.pos || !visibleAt(floor, item.pos.x, item.pos.y)) continue;
      put(tileTex(itemDefOf(item.itemId).sprite), 0.8, item.pos.x, item.pos.y, 0.4);
    }

    for (const a of state.actors) {
      if (!visibleAt(floor, a.pos.x, a.pos.y)) continue;
      if (!a.alive && a.kind === 'monster') continue;

      let tex: THREE.Texture;
      if (a.kind === 'player') {
        const row = PORTRAIT_ROW[a.job ?? 'warrior'];
        const pose = !a.alive
          ? POSE.down
          : turnEffects.effects.get(a.id)?.kind === 'lunge'
            ? POSE.attack
            : POSE.dash;
        tex = frame(
          k.jobs,
          JOB_SHEET.cols,
          JOB_SHEET.rows,
          pose + (a.facing === 'w' ? FLIP_OFFSET : 0),
          row,
        );
      } else {
        tex = tileTex(speciesOf(a.speciesId).sprite);
      }

      /*
       * **マス1枚より大きく描く。**
       * 等角にするとマスの見かけの面積が小さく、人をマスに収めると豆粒になる。
       * 足元をマスに合わせたまま上へ伸ばす。
       */
      const h = a.kind === 'player' ? 1.7 : 1.2;
      const m = put(tex, h, a.pos.x, a.pos.y, h / 2 - 0.1);

      const fx = turnEffects.effects.get(a.id);
      if (fx) m.userData.anim = { kind: fx.kind, dx: 'dx' in fx ? fx.dx : 0, dy: 'dy' in fx ? fx.dy : 0, start: now } satisfies Anim;
    }

    // 消えたものの残像。消えるあいだだけ出す
    for (const g of turnEffects.ghosts) {
      const m = put(tileTex(g.sprite), 1.2, g.pos.x, g.pos.y, 0.5);
      m.userData.anim = { kind: 'die', dx: 0, dy: 0, start: now } satisfies Anim;
      (m.material as THREE.MeshLambertMaterial).transparent = true;
    }

    // カメラと松明を自分へ
    k.target.set(cx, 0, cy);
    // 1回目だけは寄せずに合わせる。遠くから流れてくると酔う
    if (k.look.lengthSq() === 0) k.look.copy(k.target);
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
