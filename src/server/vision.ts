import { roomAt, type Floor, type GameState, type Pos, type TeamId } from '../shared/types';

/**
 * 視界の処理。
 *
 * 方式は風来のシレン型:
 *   - 部屋の中にいる → その部屋全体と、部屋を囲む壁まで見える
 *   - 通路にいる     → 足元の8近傍だけ見える
 *
 * レイキャストや影の計算（shadowcasting）は使わない。
 * コードが短く、選んだジャンルの手触りにそのまま合い、
 * 「なぜここが見えるのか」を目で追える。
 *
 * floor.visible … 今見えているか。Actor とアイテムはここが true のマスにしか出さない
 * floor.seen    … 一度でも見たか。地形だけ記憶として残す
 *
 * ## チームごとに分けてある理由（03_改善構成.md 段階D D3）
 *
 * 対戦では「相手チームが照らした部屋」が見えてはいけない。
 * だから視界は**チームごとに1組**持つ。協力モードはプレイヤーが全員チーム A で、
 * 組が1つしか作られないので、**見え方は1マスも変わらない**。
 */

/** 1チーム分の視界 */
export type TeamVision = {
  /** 今見えているか */
  visible: boolean[];
  /** 一度でも見たか（地形の記憶） */
  seen: boolean[];
};

/**
 * チームごとの視界の置き場所。
 *
 * **Floor の欄にしない。** state はそのままクライアントへ渡るので、
 * 盤に持たせると相手チームの visible まで一緒に配られてしまう。
 * visible は「相手がいまどこを照らしているか」＝居場所そのものなので、
 * 型に出さないのが一番確実。送る形を間違えようがなくなる。
 *
 * WeakMap の鍵は Floor。階を降りると Floor ごと新しくなるので、
 * 古い階の記憶は自動で消える（消し忘れが起きない）。
 */
const store = new WeakMap<Floor, Map<TeamId, TeamVision>>();

/** そのフロアの、そのチームの視界。無ければ作る */
export function visionOf(floor: Floor, team: TeamId): TeamVision {
  let byTeam = store.get(floor);
  if (!byTeam) {
    byTeam = new Map<TeamId, TeamVision>();
    store.set(floor, byTeam);
  }

  let mine = byTeam.get(team);
  if (!mine) {
    mine = {
      visible: new Array<boolean>(floor.width * floor.height).fill(false),
      /*
       * 地形の記憶は「最初のチーム」だけ、いまの floor.seen から引き継ぐ。
       *
       * 協力モードでは視界を作るより前に seen が溜まっている場合がある
       * （途中参加・あきらめた直後など）。そこを捨てると、
       * 歩いてきた跡が一瞬で消える。2つ目以降のチーム（＝対戦の相手側）は
       * まだ何も見ていないので、空から始める。
       */
      seen: byTeam.size === 0 ? [...floor.seen] : new Array<boolean>(floor.width * floor.height).fill(false),
    };
    byTeam.set(team, mine);
  }
  return mine;
}

/** 盤にいるプレイヤーのチーム。並びは 'A' → 'B' で固定（配る順を安定させる） */
export function playerTeams(state: GameState): TeamId[] {
  const found = new Set<TeamId>();
  for (const actor of state.actors) {
    if (actor.kind !== 'player') continue;
    if (actor.team === 'M') continue;
    found.add(actor.team);
  }
  return (['A', 'B'] as const).filter((t) => found.has(t));
}

export function updateVision(state: GameState): void {
  const { floor } = state;
  const teams = playerTeams(state);

  for (const team of teams) {
    const mine = visionOf(floor, team);
    mine.visible = new Array<boolean>(floor.width * floor.height).fill(false);

    for (const actor of state.actors) {
      if (actor.kind !== 'player' || actor.team !== team) continue;
      // 倒れた人の位置からも見える。偵察役として仕事を残すため
      reveal(floor, mine.visible, actor.pos);
    }

    // 今見えたマスは「見たことがある」としても記録する
    for (let i = 0; i < mine.visible.length; i++) {
      if (mine.visible[i]) mine.seen[i] = true;
    }
  }

  /*
   * 盤そのものに載せる分。
   *
   * チームが1つ（＝協力モード）なら、そのチームの視界をそのまま載せる。
   * 以前とまったく同じ中身になる。
   *
   * 対戦（2チーム）では**どちらの視界でもないので空にする。**
   * 片方を載せると、配るときに差し替え損ねた瞬間に相手へ漏れる。
   * 空なら、漏れても「何も見えない」で済む。間違えたときに
   * 情報が増える側ではなく減る側に倒しておく。
   */
  if (teams.length === 1) {
    const only = visionOf(floor, teams[0]);
    floor.visible = only.visible;
    floor.seen = only.seen;
    return;
  }
  floor.visible = new Array<boolean>(floor.width * floor.height).fill(false);
  if (teams.length > 1) floor.seen = new Array<boolean>(floor.width * floor.height).fill(false);
}

function reveal(floor: Floor, visible: boolean[], pos: Pos): void {
  const room = roomAt(floor, pos.x, pos.y);

  if (room) {
    // 部屋の中 → 部屋全体 + 囲んでいる壁の縁（-1 / +w で1マス外まで）
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        setVisible(floor, visible, x, y);
      }
    }
  }

  // 部屋にいても通路にいても、足元の8近傍は見える
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      setVisible(floor, visible, pos.x + dx, pos.y + dy);
    }
  }
}

function setVisible(floor: Floor, visible: boolean[], x: number, y: number): void {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return;
  visible[y * floor.width + x] = true;
}
