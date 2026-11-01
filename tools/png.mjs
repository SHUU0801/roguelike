/**
 * PNG の読み書き。外部ライブラリを使わない（node:zlib だけ）。
 *
 * 書き出しはスプライトシートを作るため、読み込みは
 * **手で描いた絵を取り込むため**（tools/import-art.mjs）。
 *
 * 対応しているのは 8bit の RGB / RGBA / グレースケール と、
 * インターレースなしのものだけ。描き出した PNG はたいていこれに収まる。
 * 収まらないものが来たら、ここで落として理由を言う。黙って化けるより良い。
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ── 書き出し ──────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA の生データ（width*height*4）を PNG にする */
export function encodePng(width, height, px) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // フィルタなし
    Buffer.from(px.buffer ?? px, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from(SIG),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 読み込み ──────────────────────────────────────── */

/** 1つ前の行を見て、符号化を元に戻す。PNG の仕様どおり */
function unfilter(type, line, prev, bpp) {
  switch (type) {
    case 0:
      break;
    case 1:
      for (let i = bpp; i < line.length; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
      break;
    case 2:
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + prev[i]) & 0xff;
      break;
    case 3:
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + pred) & 0xff;
      }
      break;
    default:
      throw new Error(`知らないフィルタ: ${type}`);
  }
}

/** PNG を {width, height, px(RGBA)} にする */
export function decodePng(buf) {
  for (let i = 0; i < SIG.length; i++) {
    if (buf[i] !== SIG[i]) throw new Error('PNG ではない');
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    at += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (data[12] !== 0) throw new Error('インターレースの PNG は読めない');
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (depth !== 8) throw new Error(`8bit の PNG だけ読める（いまは ${depth}bit）`);

  // 1画素あたりの入力チャンネル数
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`知らない色の種類: ${colour}`);
  if (colour === 3 && !palette) throw new Error('パレットが無い');

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * channels;
  const px = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const type = raw[off];
    const line = Buffer.from(raw.subarray(off + 1, off + 1 + stride));
    unfilter(type, line, prev, bpp);
    prev = line;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const s = x * channels;
      if (colour === 0) {
        px[i] = px[i + 1] = px[i + 2] = line[s];
        px[i + 3] = 255;
      } else if (colour === 4) {
        px[i] = px[i + 1] = px[i + 2] = line[s];
        px[i + 3] = line[s + 1];
      } else if (colour === 2) {
        px[i] = line[s];
        px[i + 1] = line[s + 1];
        px[i + 2] = line[s + 2];
        px[i + 3] = 255;
      } else if (colour === 3) {
        const p = line[s] * 3;
        px[i] = palette[p];
        px[i + 1] = palette[p + 1];
        px[i + 2] = palette[p + 2];
        px[i + 3] = trns && line[s] < trns.length ? trns[line[s]] : 255;
      } else {
        px[i] = line[s];
        px[i + 1] = line[s + 1];
        px[i + 2] = line[s + 2];
        px[i + 3] = line[s + 3];
      }
    }
  }

  return { width, height, px };
}
