import { useState } from 'react';
import { Icon } from './Icon';
import {
  describeDump,
  register,
  signIn,
  takeAccountSide,
  takeDeviceSide,
  type SignInResult,
} from './account';
import { localDump, type Dump } from './carry';

type Props = {
  onClose: () => void;
  /** 入れたら知らせる。呼ぶ側が表示を入れ替える */
  onSignedIn: (login: string) => void;
};

/**
 * 入る・つくるの画面。
 *
 * ## 書くことを絞る
 *
 * 入力は**名前とパスワードの2つだけ**。メールも、確認用のもう一度も置かない。
 * メールは送る手段が無いので集めても使えないし、
 * 集めたものは漏れたときに責任になる。
 *
 * ## 隠さないこと
 *
 * **パスワードを忘れたら戻せない。** メールを送れないため。
 * 画面に1行で出す。黙っていると、忘れた人が問い合わせ先を探して
 * 見つからずに終わる。
 *
 * ## 記録がぶつかったとき
 *
 * この端末にもアカウントにも記録がある場合、どちらかを黙って消さない。
 * 中身を一言ずつ見せて選ばせる（account.ts の conflict）。
 */
export function SignIn({ onClose, onSignedIn }: Props) {
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** ぶつかった相手の記録。null でなければ選ばせる画面になる */
  const [clash, setClash] = useState<{ login: string; theirs: Dump } | null>(null);

  const done = (r: SignInResult) => {
    if (!r.ok) {
      setError(r.message);
      return;
    }
    if (r.conflict) {
      setClash({ login: r.login, theirs: r.conflict });
      return;
    }
    // 書き戻した記録を画面に出すには読み直しが要る。やり直すより確実
    onSignedIn(r.login);
  };

  const submit = async () => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      done(mode === 'in' ? await signIn(login, password) : await register(login, password));
    } finally {
      setBusy(false);
      // パスワードは手元に残さない
      setPassword('');
    }
  };

  if (clash) {
    const mine = localDump();
    return (
      <div className="map-overlay" onClick={onClose}>
        <div className="profile-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="map-head">
            <b>どっちの記録でいく？</b>
          </div>
          <p className="hint">
            選ばなかったほうは消える。{clash.login} で入っている。
          </p>
          <button
            className="side-pick"
            onClick={() => {
              takeAccountSide(clash.theirs);
              onSignedIn(clash.login);
            }}
          >
            <b>アカウントの記録</b>
            <span>{describeDump(clash.theirs)}</span>
          </button>
          <button
            className="side-pick"
            disabled={busy}
            onClick={async () => {
              // 上げ終わる前に画面を作り直すと、送りかけが切れる
              setBusy(true);
              await takeDeviceSide();
              onSignedIn(clash.login);
            }}
          >
            <b>この端末の記録</b>
            <span>{describeDump(mine)}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="map-overlay" onClick={onClose}>
      <div className="profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>アカウント</b>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="carry-tabs">
          <button
            className={mode === 'in' ? 'on' : ''}
            onClick={() => {
              setMode('in');
              setError('');
            }}
          >
            <Icon id="lock" size={16} />
            入る
          </button>
          <button
            className={mode === 'new' ? 'on' : ''}
            onClick={() => {
              setMode('new');
              setError('');
            }}
          >
            <Icon id="check" size={16} />
            つくる
          </button>
        </div>

        <form
          className="sign-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/*
            autoComplete を付けておく。ブラウザの記憶に任せられるので、
            こちらが覚えておく必要がなくなる。
          */}
          <input
            className="name-input"
            value={login}
            maxLength={20}
            placeholder="なまえ（英数字）"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setLogin(e.target.value.trim())}
          />
          <input
            className="name-input"
            type="password"
            value={password}
            maxLength={200}
            placeholder="パスワード（8文字以上）"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="wide primary" type="submit" disabled={busy}>
            {busy ? 'まってね' : mode === 'in' ? '入る' : 'つくる'}
          </button>
        </form>

        {error && <p className="warn">{error}</p>}

        <p className="hint">
          {mode === 'new'
            ? 'いまこの端末にある記録がそのまま引き継がれる。'
            : 'どの端末からでも同じ記録で遊べる。'}
        </p>
        {/* 方式そのものの限界。隠さない（09_ログイン.md §1） */}
        <p className="hint">
          パスワードは忘れると戻せない。心配なら「じぶん」の引き継ぎコードも残しておく。
        </p>
      </div>
    </div>
  );
}
