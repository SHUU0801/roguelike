import { useState } from 'react';
import { Icon } from './Icon';
import {
  exportCode,
  importCode,
  loadProfile,
  setName,
  userLevel,
  type Profile,
} from './profile';

type Props = {
  onClose: () => void;
  /** 名前を変えたらサーバーにも伝える。仲間の一覧に出るので */
  onRename: (name: string) => void;
};

/**
 * ユーザーの画面。キャラ（職業）とは別の、遊ぶ人そのもの。
 *
 * **本物のアカウントではない**ことを隠さない。
 * サーバーに保存先が無いので、ブラウザのデータを消すと無くなる。
 * 代わりに引き継ぎコードを置いてある（profile.ts）。
 *
 * 画面に出す説明は1行だけにする。長い話は「あそびかた」の仕事。
 */
export function ProfileSheet({ onClose, onRename }: Props) {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [draft, setDraft] = useState(profile.name);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'none' | 'out' | 'in'>('none');
  const [failed, setFailed] = useState(false);

  const lv = userLevel(profile.exp);

  const commitName = () => {
    const name = draft.trim().slice(0, 12);
    setName(name);
    setProfile(loadProfile());
    onRename(name);
  };

  return (
    <div className="map-overlay" onClick={onClose}>
      <div className="profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>じぶん</b>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="lv-row">
          <span className="lv-badge">Lv{lv.level}</span>
          <span className="bar">
            <i style={{ width: `${Math.min(100, (lv.into / lv.need) * 100)}%` }} />
          </span>
          <b>
            {lv.into}/{lv.need}
          </b>
        </div>

        <input
          className="name-input"
          value={draft}
          maxLength={12}
          placeholder="なまえ"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
        />

        <div className="stat-tiles">
          <span className="stat-tile">
            <Icon id="map" size={16} />
            <b>{profile.runs}</b>
            <span>もぐった</span>
          </span>
          <span className="stat-tile">
            <Icon id="check" size={16} />
            <b>{profile.clears}</b>
            <span>とうは</span>
          </span>
          <span className="stat-tile">
            <Icon id="skull" size={16} />
            <b>B{profile.deepest}F</b>
            <span>さいしん</span>
          </span>
        </div>

        {/* 引き継ぎ。サーバーが無いので、別の端末へはこれでしか移せない */}
        <div className="carry">
          <div className="carry-tabs">
            <button
              className={mode === 'out' ? 'on' : ''}
              onClick={() => {
                setMode(mode === 'out' ? 'none' : 'out');
                setCode(exportCode());
                setFailed(false);
              }}
            >
              <Icon id="lock" size={16} />
              コードを出す
            </button>
            <button
              className={mode === 'in' ? 'on' : ''}
              onClick={() => {
                setMode(mode === 'in' ? 'none' : 'in');
                setCode('');
                setFailed(false);
              }}
            >
              <Icon id="check" size={16} />
              コードを入れる
            </button>
          </div>

          {mode !== 'none' && (
            <>
              <textarea
                className="carry-code"
                readOnly={mode === 'out'}
                value={code}
                placeholder="ここにコードを貼る"
                onChange={(e) => setCode(e.target.value)}
                onFocus={(e) => mode === 'out' && e.target.select()}
              />
              {mode === 'in' && (
                <button
                  className="wide primary"
                  onClick={() => {
                    if (importCode(code)) location.reload();
                    else setFailed(true);
                  }}
                >
                  読みこむ
                </button>
              )}
              {failed && <p className="warn">コードが読めない</p>}
              <p className="hint">
                このコードを写せば別の端末に移せる。
                {mode === 'in' && ' 読みこむと今のデータは消える。'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
