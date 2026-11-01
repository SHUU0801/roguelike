import { useState } from 'react';
import { Icon } from './Icon';
import { getVolume, isMuted, setMuted, setVolume, sfx } from './sfx';

type Props = {
  onClose: () => void;
  onHowTo: () => void;
  /** あきらめて帰る。持ち物は持ち帰れない */
  onRetire: () => void;
};

/**
 * ダンジョン中のメニュー。
 *
 * ヘッダーのボタンを3つ（あそびかた・地図・音）並べていたら、
 * 375px でステータスの数字を押しのけ始めていた。
 * **音と設定とあきらめるを1つにまとめて、ヘッダーは歯車1つ**にする。
 * 地図は遊んでいる最中に何度も開くので、ヘッダーに残す。
 *
 * 「あきらめる」を置いたのは、**詰んだときに帰る手段が無かった**から。
 * 松明が尽きて階段も見つからないと、死ぬまで歩くしかなかった。
 */
export function GameMenu({ onClose, onHowTo, onRetire }: Props) {
  const [muted, setMutedState] = useState(isMuted);
  const [volume, setVolumeState] = useState(getVolume);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="map-overlay" onClick={onClose}>
      <div className="game-menu" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>メニュー</b>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="setting-row">
          <button
            className="icon-btn"
            aria-label={muted ? '音を出す' : '音を消す'}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) sfx.pickup();
            }}
          >
            <Icon id={muted ? 'mute' : 'sound'} size={16} />
          </button>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            disabled={muted}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVolume(v);
              setVolumeState(v);
            }}
            // 離したときに1回だけ鳴らす。動かすたびに鳴らすとうるさい
            onPointerUp={() => !muted && sfx.pickup()}
          />
          <b className="slider-value">{muted ? '—' : Math.round(volume * 100)}</b>
        </div>

        <button className="wide" onClick={onHowTo}>
          <Icon id="question" size={16} /> あそびかた
        </button>

        {/* あきらめる。持ち物を失うので、一度確かめる */}
        {confirming ? (
          <div className="retire-confirm">
            <p className="warn">持ち物は全部なくなる</p>
            <div className="invite-actions">
              <button className="wide" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button className="wide danger" onClick={onRetire}>
                あきらめる
              </button>
            </div>
          </div>
        ) : (
          <button className="wide danger" onClick={() => setConfirming(true)}>
            <Icon id="flee" size={16} /> あきらめる
          </button>
        )}
      </div>
    </div>
  );
}
