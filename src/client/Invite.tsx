import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

type Props = {
  url: string;
  onClose: () => void;
};

/**
 * 仲間を呼ぶ画面。
 *
 * 呼び方を3つ並べる。どれが使えるかは端末と相手次第なので、選べるようにする。
 *
 *   わたす  OS の共有（LINE などへ直接）。使えない端末では出さない
 *   コピー  URL をクリップボードへ
 *   QR      目の前の人に読ませる。送る手段そのものが要らない
 *
 * QR を入れたのは、**隣に座っている人を誘うのが一番多い**だろうから。
 * URL を送るには相手の連絡先が要るが、QR なら画面を見せるだけで済む。
 *
 * コードの生成は qrcode-generator（MIT）に任せる。
 * QR は誤り訂正符号まで要るので、自分で書くものではない。
 * 絵は自分で描く方針（08_参考にしたもの.md §5）だが、これは絵ではなく符号。
 */
export function Invite({ url, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  /** 白黒のマス目。SVG で描く。画像を作らないので拡大してもぼやけない */
  const qr = useMemo(() => {
    // 0 = 入る大きさを自動で選ぶ。L = 誤り訂正は最小（画面に出すので汚れない）
    const code = qrcode(0, 'L');
    code.addData(url);
    code.make();
    const n = code.getModuleCount();
    const dark: { x: number; y: number }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (code.isDark(y, x)) dark.push({ x, y });
      }
    }
    return { n, dark };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // http の LAN 越しだとクリップボードが使えない。URL は下に出してある
      setCopied(false);
    }
  };

  // OS の共有。対応していない端末（PC の多く）では出さない
  const canShare = typeof navigator.share === 'function';
  const share = async () => {
    try {
      await navigator.share({ url });
    } catch {
      // 利用者が取り消しただけのことが多い。何もしない
    }
  };

  return (
    <div className="map-overlay" onClick={onClose}>
      <div className="invite-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="map-head">
          <b>さそう</b>
          <button onClick={onClose}>閉じる</button>
        </div>

        {/* 余白（静寂域）を4マスぶん取る。詰めると読み取れない端末がある */}
        <svg
          className="qr"
          viewBox={`0 0 ${qr.n + 8} ${qr.n + 8}`}
          role="img"
          aria-label="合流用の QR コード"
        >
          <rect width={qr.n + 8} height={qr.n + 8} fill="#ffffff" />
          {qr.dark.map((m) => (
            <rect key={`${m.x},${m.y}`} x={m.x + 4} y={m.y + 4} width={1} height={1} fill="#101418" />
          ))}
        </svg>

        <div className="invite-actions">
          {canShare && (
            <button className="wide primary" onClick={share}>
              わたす
            </button>
          )}
          <button className="wide" onClick={copy}>
            {copied ? 'コピーした' : 'URL をコピー'}
          </button>
        </div>

        <input className="invite" readOnly value={url} onFocus={(e) => e.target.select()} />
      </div>
    </div>
  );
}
