/**
 * v0 の型定義。サーバーとクライアントが両方これを import する。
 * 「同じ言語・同じ型をサーバーとクライアントで使い回す」のがこの構成の狙い。
 */

import type { DungeonId } from './dungeons';
import { itemDefOf } from './items';
import type { JobId } from './jobs';
import type { PerkId } from './perks';
import type { EffectId, SkillId } from './skills';

export type TileKind = 'wall' | 'floor' | 'stairs';

export type Pos = { x: number; y: number };

export type Dir = 'n' | 's' | 'e' | 'w';

/** プレイヤーのチーム。対戦（v1.5）では2つに分かれる */
export type TeamId = 'A' | 'B';

/** 盤上の所属。モンスターはどちらの味方でもないので 'M' */
export type Faction = TeamId | 'M';

/** 部屋の矩形。視界の処理とモンスターの配置に使う */
export type Rect = { x: number; y: number; w: number; h: number };

/** 方向 → 座標の差分 */
export const DIR_DELTA: Record<Dir, Pos> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

/**
 * 既定のダンジョンの深さ。実際の深さはダンジョンごとに違う
 * （shared/dungeons.ts の depth）。ここは表示の保険にだけ残してある。
 */
export const MAX_DEPTH = 5;

/**
 * 松明の残り。毎ターン1ずつ減り、0 になると毎ターン傷つく。
 *
 * これが「時間を資源にする」仕掛け（03_改善構成.md 段階B）。
 * これが無いと、通路に1歩下がれば無料で安全・時間を使っても何も減らないので、
 * プレイヤーは一番安全で退屈な手を選び続けることになる。
 *
 * **数値は遊んで決めるもの。** 1ランは150〜220ターン前後の見込みなので、
 * 全部の部屋を漁ると足りなくなるくらいを狙っている。
 */
export const FUEL_START = 260;
export const FUEL_REFILL = 90;
/** これを下回ったら警告を出す */
export const FUEL_WARN = 50;
export const FUEL_DANGER = 20;

/** 1部屋に入れる人数 */
export const MAX_PLAYERS = 4;

/**
 * バックパックの大きさ。
 *
 * 5×4 = 20 マス。盾（2×2）が4マス、剣（縦3）が3マスなので、
 * 「全部持つ」が成立しない大きさにしてある。
 * 広げると判断が消え、狭めると拾う楽しみが消える。遊んで決めること。
 */
export const BAG_W = 5;
export const BAG_H = 4;

/**
 * 1ターンの制限時間。
 * これが無いと、放置した1人が全員を止めてマルチプレイが破綻する（ゴール定義 §2）。
 * 計測は「そのターンで最初の誰かが動いた瞬間」から始まる。
 * 1人で遊んでいるときは動かない。
 */
export const TURN_LIMIT_MS = 12_000;

/**
 * 盤上で動くもの。プレイヤーもモンスターも同じ型にする。
 * 型を分けると戦闘処理を2回書くことになるため（設計書 §3-1）。
 */
export type Actor = {
  id: string;
  kind: 'player' | 'monster';
  /**
   * 敵味方の判定に使う。協力モードではプレイヤーは全員 'A'。
   * kind で判定しないのが要点（02_v1設計.md §6 の申し送り）。
   * 対戦では 'A' と 'B' に分かれるが、判定する側のコードは変えなくて済む。
   */
  team: Faction;
  speciesId: string; // 性能は shared/monsters.ts の表を引く
  pos: Pos;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  alive: boolean;
  /**
   * 自分から去ったか（倒れたのではなく「あきらめる」を押した）。
   *
   * 状態としてはどちらも alive === false だが、
   * **終わり方の文面が変わる。** 引き返した人に「全滅」と出すと、
   * 自分で決めて帰ったことが事故のように見える。
   */
  left?: boolean;
  /** 松明の残り。プレイヤーだけが持つ（モンスターは 0 のまま使わない） */
  fuel: number;
  /**
   * 何人目か（1〜4）。全員が同じ見た目なので、番号が無いと
   * 「盤上のどれが誰か」「HP 3 なのは誰か」が対応付けられない。
   * モンスターは 0。
   */
  slot: number;

  /**
   * 向いている方向。
   *
   * モンスターが使う。背後から忍び寄れるようにするために要る
   * （06_職業とレベルの設計.md §8）。プレイヤーは向きを持たない：
   * スマホで向きを変える操作を足すとボタンがもう1つ要るうえ、
   * タップで歩くこのゲームでは「向きを変えるだけのターン」が苦行になる。
   */
  facing: Dir;

  /**
   * こちらに気づいているか。モンスターが使う。
   *
   * 気づいていない敵は追ってこないし、殴られても1ターン反撃できない。
   * 「ぶつかったら必ず殴り返される」を無くすための中心。
   */
  aware: boolean;

  /**
   * 一時的な状態 → それが切れるターン。
   * 毒・凍結・隠密・防御上昇をここにまとめる（shared/skills.ts の EffectId）。
   */
  effects: Partial<Record<EffectId, number>>;

  // --- ここから下はプレイヤーだけが使う ---

  /**
   * 遊んでいる人の名前。キャラの名前ではない。
   * 仲間の一覧で「1番」より分かりやすくするためだけに使う。
   * 空なら番号で呼ぶ。
   */
  name: string;

  /** 職業。ロビーで選ぶ。選ばないまま始めたら戦士になる */
  job: JobId | null;

  /** 覚えているわざ。職業の基本わざ1つから始まり、カードで増える */
  skills: SkillId[];

  /** わざ → 次に使えるターン。わざごとに別々に待つ */
  cooldowns: Partial<Record<SkillId, number>>;
  level: number;
  /** 今のレベルの中での経験値。レベルが上がるたび 0 に戻る */
  exp: number;
  /** まだカードを選んでいないレベルアップの回数。溜められる */
  pendingLevels: number;
  /**
   * いま提示している3枚。選ぶまで変わらない。
   *
   * サーバーが持つのが要点。クライアント側で引くと、リロードで引き直せてしまう。
   *
   * **ここは対戦でも運のままにする。** 00_ゴール定義.md が消そうとしているのは
   * 「同じ判断をしたのに結果が違う」運（攻撃が外れる類い）であって、運そのものではない。
   * カードは**決める前に見える**ので、引きが変われば作戦が変わる。
   * 運が判断を生む側に回っているから、これは入れていい運。
   */
  offers: PerkId[];
  /** 取った強化。同じものを取りすぎないように数を見る */
  perks: PerkId[];
};

export type ItemInstance = {
  id: string;
  itemId: string; // 効果は shared/items.ts の表を引く
  pos: Pos | null; // 床にある → 座標 / 誰かが持っている → null
  ownerId: string | null;
  /**
   * バックパックの中の位置（左上のマス）。床にあるときは null。
   * 配置はサーバーが持つ。クライアントで持つと、並べ替えで物が増やせてしまう。
   */
  at: Pos | null;
  /** 向き。0 がそのまま、1 が90度回した形 */
  rot: number;
  /**
   * 外しているか。外しても袋のマスは食う。
   *
   * 剣には「防御 -1」が付いているので、守りに回るときは外したい。
   * ただし**外すのに1ターン使う**（Intent にしてある）。
   * 無料だと毎ターン付け外しできてしまい、剣の弱点が無いのと同じになる。
   */
  off?: boolean;
};

export type Floor = {
  depth: number;
  width: number;
  height: number;
  /** 1次元配列。index = y * width + x */
  tiles: TileKind[];
  /** 生成された部屋。視界の処理に使う */
  rooms: Rect[];
  /** 一度でも見たか。地形だけ記憶として残すのに使う */
  seen: boolean[];
  /** 今この瞬間見えているか。Actor とアイテムはここが true のマスにしか出さない */
  visible: boolean[];
};

/** サーバーが持つ唯一の正しい状態 */
export type GameState = {
  /** lobby = 仲間を待っている状態。「はじめる」で playing になる */
  phase: 'lobby' | 'playing' | 'won' | 'lost';
  /**
   * lost の中身。全員が自分から引き返したなら 'left'、
   * 1人でも倒れていたなら 'dead'。文面を分けるためだけに持つ。
   */
  lostBy?: 'dead' | 'left';
  /**
   * どのダンジョンに潜っているか。部屋を作った人が選ぶ。
   * 地形の見た目・深さ・出る敵がこれで変わる（shared/dungeons.ts）。
   */
  dungeon: DungeonId;
  turn: number;
  floor: Floor;
  actors: Actor[];
  items: ItemInstance[];
  log: string[];
  /**
   * 「降りる」に同意した人。全員が押すまで降りない。
   * 1人が踏むと全員が引きずられ、床のアイテムが無警告で消えていた事故の対策。
   */
  descendReady: string[];
  /** このフロアに入ったターン。1フロアの所要ターンを測るのに使う */
  floorStartedAt: number;
  /** まだ今ターンの行動を送っていないプレイヤーの id */
  waitingFor: string[];
  /** ターンの締め切り（epoch ミリ秒）。待っていないときは null */
  deadlineAt: number | null;
};

/**
 * プレイヤーがサーバーに送る「意図」。
 * 「攻撃」が無いのは、移動先にモンスターがいたらサーバーが攻撃に読み替えるため
 * （ローグライク定番の体当たり攻撃。ボタンが1つ減ってスマホの画面が助かる）。
 */
export type Intent =
  | { type: 'move'; dir: Dir }
  | { type: 'useItem'; instanceId: string }
  | { type: 'pickUp' }
  /** 足元に置く。仲間に渡す唯一の手段 */
  | { type: 'drop'; instanceId: string }
  /** 隣で倒れている仲間を起こす。自分の最大HPを払う */
  | { type: 'revive' }
  /** わざ。覚えているものが複数あるので、どれを使うかを指定する */
  | { type: 'skill'; skillId: string }
  /** 装備を付けたり外したり。1ターン使う */
  | { type: 'toggleEquip'; instanceId: string }
  | { type: 'descend' }
  | { type: 'wait' };

/**
 * レベルの上限。
 *
 * 5フロアで全部の敵を倒しても 6 前後にしかならないので、10 は事実上の安全弁。
 * 上限が無いと、粘って敵を狩り続けるのが最適解になり、
 * 松明で「時間を資源にする」ために入れた仕掛け（段階B）と正面からぶつかる。
 */
export const MAX_LEVEL = 10;

/**
 * 次のレベルまでに要る経験値。
 *
 * 1→2 が 14、以降 +6 ずつ。5 まで上げるのに合計 92。
 * 1ランで出る敵は 40 体前後（depth で増える）、経験値は1体 3〜6 なので、
 * 半分強を倒すとレベル 5 あたりに着く。全部倒して 6〜7。
 * **机上の計算。たいまつの数値と同じで、遊んでから詰める。**
 */
export function expToNext(level: number): number {
  return 8 + level * 6;
}

/** 蘇生の代償。アイテムを要求しない（出なかったランで詰むのを避ける） */
export const REVIVE_COST = 4;

/** マスの種類を取り出す。範囲外は壁として扱う */
export function tileAt(floor: Floor, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return 'wall';
  return floor.tiles[y * floor.width + x];
}

/**
 * 袋に入れている装備ぶんを足した実際の能力。
 *
 * **装備は袋に入っている間だけ効く**（shared/items.ts）。
 * 以前は「使う」と消えて能力が上がりっぱなしで、
 * 使った瞬間に袋が空くので持っているほうが損だった。
 * 袋のマスを食い続けるからこそ、剣を2本持つか薬草を入れるかが判断になる。
 *
 * 戦闘も画面もここを通す。素の値（actor.atk）を直接見てはいけない。
 */
export function equipBonus(state: GameState, actorId: string): { atk: number; def: number } {
  let atk = 0;
  let def = 0;
  for (const item of state.items) {
    if (item.ownerId !== actorId || item.at === null) continue;
    if (item.off) continue; // 外している。マスは食うが効かない
    const e = itemDefOf(item.itemId).equip;
    if (!e) continue;
    atk += e.atk ?? 0;
    def += e.def ?? 0;
  }
  return { atk, def };
}

export function effectiveAtk(state: GameState, actor: Actor): number {
  return Math.max(1, actor.atk + equipBonus(state, actor.id).atk);
}

export function effectiveDef(state: GameState, actor: Actor): number {
  return Math.max(0, actor.def + equipBonus(state, actor.id).def);
}

/** その状態が今効いているか。値は「このターンまで」 */
export function hasEffect(actor: Actor, id: EffectId, turn: number): boolean {
  const until = actor.effects[id];
  return until !== undefined && turn <= until;
}

/** 状態を付ける。すでに付いているときは長いほうを残す */
export function addEffect(actor: Actor, id: EffectId, turn: number, lasts: number): void {
  const until = turn + lasts;
  const current = actor.effects[id];
  actor.effects[id] = current === undefined ? until : Math.max(current, until);
}

/** そのマスが一度でも見えたか（地形の記憶） */
export function seenAt(floor: Floor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
  return floor.seen[y * floor.width + x];
}

/** そのマスが今見えているか */
export function visibleAt(floor: Floor, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
  return floor.visible[y * floor.width + x];
}

/** その座標を含む部屋。通路にいるなら undefined */
export function roomAt(floor: Floor, x: number, y: number): Rect | undefined {
  return floor.rooms.find(
    (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
  );
}

/**
 * 敵対しているか。**kind では判定しない。**
 * これ1つに閉じておけば、v1.5 でプレイヤー同士を戦わせるときも
 * 呼び出し側を書き換えずに済む。
 */
export function isHostile(a: Actor, b: Actor): boolean {
  return a.team !== b.team;
}

/** その座標にいる、生きている Actor */
export function actorAt(state: GameState, x: number, y: number): Actor | undefined {
  return state.actors.find((a) => a.alive && a.pos.x === x && a.pos.y === y);
}

/** その座標の床に落ちているアイテム */
export function itemAt(state: GameState, x: number, y: number): ItemInstance | undefined {
  return state.items.find((i) => i.pos !== null && i.pos.x === x && i.pos.y === y);
}

/** from から to への方向。隣接していなければ null */
export function dirTo(from: Pos, to: Pos): Dir | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === -1) return 'n';
  if (dx === 0 && dy === 1) return 's';
  if (dx === 1 && dy === 0) return 'e';
  if (dx === -1 && dy === 0) return 'w';
  return null;
}
