import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// 1024x1024 RGBA: dark navy background + accent "window" pattern
const W = 1024;
const H = 1024;
const raw = Buffer.alloc(H * (1 + W * 4));

for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 4);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const i = rowStart + 1 + x * 4;
    const inRect = x > 96 && x < 928 && y > 96 && y < 928;
    const inBar = inRect && y > 240 && y < 340;
    const inBar2 = inRect && x > 240 && x < 340;
    const border = inRect && (x < 128 || x > 896 || y < 128 || y > 896);
    if (border) {
      raw[i] = 0x60;
      raw[i + 1] = 0x82;
      raw[i + 2] = 0xfa;
      raw[i + 3] = 0xff;
    } else if (inBar || inBar2) {
      raw[i] = 0x60;
      raw[i + 1] = 0x82;
      raw[i + 2] = 0xfa;
      raw[i + 3] = 0xcc;
    } else if (inRect) {
      raw[i] = 0x14;
      raw[i + 1] = 0x15;
      raw[i + 2] = 0x19;
      raw[i + 3] = 0xff;
    } else {
      raw[i] = 0x0c;
      raw[i + 1] = 0x0d;
      raw[i + 2] = 0x10;
      raw[i + 3] = 0xff;
    }
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// CRC32 (PNG uses IEEE polynomial)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../src-tauri/icons/app-icon.png', import.meta.url), png);
console.log('icon written:', png.length, 'bytes');
