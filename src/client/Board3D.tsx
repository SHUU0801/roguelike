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
  actorAt,
  dirTo,
  itemAt,
  seenAt,
  tileAt,
  visibleAt,
  type Dir,
  type GameState,
} from '../shared/types';
import type { TurnEffects } from './useTurnEffects';

/**
 * ダンジョンの盤を three.js で描く（試作）。
 *
 * ## なぜ作ったか
 *
 * CSS の 3D 変換で寝かせるところまではできたが、3つで詰まった:
 *   1. 等角にするとキャラが豆粒になる（マス1枚より大きく描けない）
 *   2. 手前のキャラが奥のキャラを隠さない（重なり順が無い）
 *   3. 松明を本物の光にできない
 *
 * どれも 3D なら仕組みとして付いてくる。とくに 3 が大きい。
 * **松明はこのゲームの芯の仕掛け**（時間を資源にする）なのに、
 * CSS では「暗いクラス」でしかなく、燃料が減っても画面は変わらなかった。
 * ここでは点光源にして、燃料が減るほど光が狭まるようにしてある。
 *
 * ## 作りの約束
 *
 * **ゲームの状態は一切持たない。** `state` を受け取って見た目に直すだけ。
 * サーバーが唯一の正しい状態という約束（00_ゴール定義.md）は変えない。
 * だから描画を丸ごと捨ててもゲームは壊れない。
 *
 * 盤だけ three.js にして、ヘッダー・ログ・行動ボタン・持ち物は DOM のまま。
 * 文字と押しやすさは DOM のほうが強い。
 */

/** 見える範囲（マス数）。等角は正方形より幅を食うので CSS 版より狭い */
const VIEW = 9;

/** カメラの角度。寝かせ具合と回り込み */
const CAM_TILT = Math.PI / 4.4;
const CAM_YAW = Math.PI / 4;

type Props = {
  state: GameState;
  myId: string;
  turnEffects: TurnEffects;
  onMove: (dir: Dir) => void;
  onTravel: (to: { x: number; y: number }) => void;
  path: readonly { x: number; y: number }[];
};

/** ドット絵をぼかさずに読む */
function loadSheet(url: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * シートの1枠だけを映すテクスチャを作る。
 *
 * three.js のテクスチャは `repeat` と `offset` で切り出す。
 * 大もとを共有すると offset も共有されてしまうので、
 * 枠ごとに clone する。**clone しても画像は1枚しか読まれない。**
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
  /** three の持ち物。React の再描画で作り直さない */
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
    raf: number;
  } | null>(null);

  /** 最新の値をイベントハンドラから読むための箱 */
  const live = useRef({ state, myId, onMove, onTravel });
  live.current = { state, myId, onMove, onTravel };

  // ── 組み立て。1回だけ ───────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();

    /*
     * 正射影カメラ。遠近を付けない。
     * 遠近を付けると奥のマスが小さくなって、同じ広さの部屋が歪んで見える。
     * 等角のゲームが正射影なのはこのため。
     */
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(
      Math.sin(CAM_YAW) * 20,
      Math.tan(CAM_TILT) * 20,
      Math.cos(CAM_YAW) * 20,
    );
    camera.lookAt(0, 0, 0);
    scene.add(camera);

    /*
     * 松明。**このゲームの芯の仕掛けを光にする。**
     * 燃料が減るほど distance（届く距離）を縮める。
     */
    const torch = new THREE.PointLight(0xffd9a0, 9, 11, 1.1);
    torch.position.set(0, 1.6, 0);
    scene.add(torch);

    // 真っ暗だと形すら見えないので、ごく弱い環境光だけ入れる
    scene.add(new THREE.AmbientLight(0x3f4a5c, 0.55));

    /*
     * 上からの弱い光。環境光だけだと面の向きが出ず、
     * 床も人も同じ明るさののっぺりした絵になる。
     */
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
      raf: 0,
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

    const loop = () => {
      kit.current!.raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(kit.current!.raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
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
        const m = child as THREE.Mesh;
        m.geometry?.dispose();
      }
    };
    clear(k.ground);
    clear(k.things);

    const cx = me ? me.pos.x : Math.floor(floor.width / 2);
    const cy = me ? me.pos.y : Math.floor(floor.height / 2);
    const half = Math.ceil(VIEW / 2) + 1;

    const flat = new THREE.PlaneGeometry(1, 1);
    const onPath = new Set(path.map((p) => `${p.x},${p.y}`));

    for (let y = cy - half; y <= cy + half; y++) {
      for (let x = cx - half; x <= cx + half; x++) {
        const tile = tileAt(floor, x, y);
        const visible = visibleAt(floor, x, y);
        const known = visible || seenAt(floor, x, y);
        if (!known || tile === 'wall') continue;

        /*
         * 床。本物の平面に貼るので、真上から描いた四角いドット絵のままでいい。
         * 菱形に描き直す必要が無いのは 3D（と CSS の 3D）の利点。
         */
        const mat = new THREE.MeshLambertMaterial({
          map: tileTex(tile === 'floor' ? theme.floor : TILE_SPRITE[tile]),
          transparent: true,
        });
        if (!visible) mat.color.setScalar(0.45); // 記憶だけのマスは沈める
        if (onPath.has(`${x},${y}`)) mat.emissive.setHex(0x1c3a2a);

        const cell = new THREE.Mesh(flat.clone(), mat);
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(x - cx, 0, y - cy);
        cell.userData = { x, y };
        k.ground.add(cell);
      }
    }

    /** 画面に正対させる。カメラは固定なので向きを写すだけでいい */
    const billboard = (m: THREE.Object3D) => {
      m.rotation.set(-CAM_TILT, CAM_YAW, 0, 'YXZ');
    };

    // 床に落ちているもの
    for (const item of state.items) {
      if (!item.pos || !visibleAt(floor, item.pos.x, item.pos.y)) continue;
      const mat = new THREE.MeshLambertMaterial({
        map: tileTex(itemDefOf(item.itemId).sprite),
        transparent: true,
        alphaTest: 0.35,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat);
      m.position.set(item.pos.x - cx, 0.4, item.pos.y - cy);
      billboard(m);
      k.things.add(m);
    }

    // 人と敵
    for (const a of state.actors) {
      if (!visibleAt(floor, a.pos.x, a.pos.y)) continue;
      if (!a.alive && a.kind === 'monster') continue;

      let tex: THREE.Texture;
      if (a.kind === 'player') {
        const row = PORTRAIT_ROW[a.job ?? 'warrior'];
        const pose = a.alive ? POSE.dash : POSE.down;
        const col = pose + (a.facing === 'w' ? FLIP_OFFSET : 0);
        tex = frame(k.jobs, JOB_SHEET.cols, JOB_SHEET.rows, col, row);
      } else {
        tex = tileTex(speciesOf(a.speciesId).sprite);
      }

      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.35,
      });
      /*
       * **マス1枚より大きく描く。**
       * 等角にするとマスの見かけの面積が小さく、人をマスに収めると豆粒になる。
       * 足元をマスの中心に置いたまま上へ伸ばす。
       */
      const h = a.kind === 'player' ? 1.7 : 1.2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h, h), mat);
      m.position.set(a.pos.x - cx, h / 2 - 0.08, a.pos.y - cy);
      billboard(m);
      k.things.add(m);
    }

    /*
     * 松明の強さ。燃料が尽きるほど光が狭まる。
     * CSS 版では「暗いクラス」でしかなく、燃料が減っても画面は変わらなかった。
     */
    const fuel = me ? Math.max(0, Math.min(1, me.fuel / FUEL_START)) : 0;
    /*
     * 明るさは「読める」と「潜っている」の綱引き。
     * 環境光を上げたら、床が白っぽくなって洞窟に見えなくなった。
     * 環境光は形が分かる最低限にして、**明るさは松明に持たせる。**
     * 燃料が減るほど届く距離が縮み、周りから闇が寄ってくる。
     */
    k.torch.distance = 3 + fuel * 7;
    k.torch.intensity = 5 + fuel * 9;
    k.torch.position.set(0, 1.5, 0);

    void turnEffects;
  }, [state, myId, path, turnEffects]);

  // ── タップ。レイキャストで床を拾う ─────────────────
  useEffect(() => {
    const el = host.current;
    const k = kit.current;
    if (!el || !k) return;

    const ray = new THREE.Raycaster();
    const pt = new THREE.Vector2();

    const onClick = (e: PointerEvent) => {
      const k2 = kit.current;
      if (!k2) return;
      const r = el.getBoundingClientRect();
      pt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(pt, k2.camera);
      const hit = ray.intersectObjects(k2.ground.children, false)[0];
      if (!hit) return;

      const { x, y } = hit.object.userData as { x: number; y: number };
      const { state: s, myId: id, onMove: move, onTravel: travel } = live.current;
      const self = s.actors.find((a) => a.id === id);
      if (!self) return;

      // 隣なら1歩、遠ければそこまで歩く。CSS 版と同じ決まり
      const dir = dirTo(self.pos, { x, y });
      if (dir) move(dir);
      else travel({ x, y });
    };

    el.addEventListener('pointerup', onClick);
    return () => el.removeEventListener('pointerup', onClick);
  }, []);

  void actorAt;
  void itemAt;

  return <div className="board3d" ref={host} />;
}
