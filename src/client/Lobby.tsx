import { useState } from 'react';
import { MAX_PLAYERS, type GameState } from '../shared/types';

type Props = {
  state: GameState;
  myId: string;
  inviteUrl: string;
  onStart: () => void;
};

/**
 * 探索を始める前の待機画面。
 *
 * マッチングの仕組みは作らない。URL を送って合流してもらう形にしておけば、
 * 同時接続が少ないうちでも「人がいなくて遊べない」が起きない（ゴール定義 §2）。
 */
export function Lobby({ state, myId, inviteUrl, onStart }: Props) {
  const [copied, setCopied] = useState(false);
  const players = state.actors.filter((a) => a.kind === 'player');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // http の LAN 越しだとクリップボードが使えない。URL は下に出してあるので手で選べる
      setCopied(false);
    }
  };

  return (
    <div className="lobby">
      <h1>ダンジョンへ</h1>

      <section>
        <h2>
          仲間 {players.length} / {MAX_PLAYERS}
        </h2>
        <ul className="party-list">
          {players.map((p) => (
            <li key={p.id}>
              🧑 {p.id === myId ? 'あなた' : '仲間'}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>この URL を送ると合流できる</h2>
        <input className="invite" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
        <button className="wide" onClick={copy}>
          {copied ? 'コピーした' : 'URL をコピー'}
        </button>
        {/* 開発中だけの注意。公開したらインターネット越しに入れるので出さない */}
        {import.meta.env.DEV && (
          <p className="hint">
            開発中は同じ Wi-Fi に繋いでから開くこと（Network: の URL を使う）。
          </p>
        )}
      </section>

      <button className="wide primary" onClick={onStart}>
        はじめる
      </button>
      <p className="hint">1人でも始められる。後から合流もできる。</p>
    </div>
  );
}
