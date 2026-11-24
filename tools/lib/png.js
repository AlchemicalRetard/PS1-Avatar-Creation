// Minimal 8-bit PNG reader/writer (RGB/RGBA, non-interlaced). No dependencies.
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const scan = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scan, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let width, height, channels;
  const idat = [];
  for (let o = 8; o < bytes.length;) {
    const length = bytes.readUInt32BE(o), type = bytes.toString('latin1', o + 4, o + 8);
    const body = bytes.subarray(o + 8, o + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = { 2: 3, 6: 4 }[body[9]];
      if (body[8] !== 8 || !channels || body[12]) throw new Error('Unsupported PNG format');
    }
    if (type === 'IDAT') idat.push(body);
    o += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels;
  const rows = new Uint8Array(stride * height), data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? rows[y * stride + i - channels] : 0;
      const up = y ? rows[(y - 1) * stride + i] : 0;
      const corner = y && i >= channels ? rows[(y - 1) * stride + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rows[y * stride + i] = raw[y * (stride + 1) + 1 + i] + predicted;
    }
  }
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 4; k++) data[i * 4 + k] = k < channels ? rows[i * channels + k] : 255;
  }
  return { width, height, data };
}

const writePng = (file, image) => fs.writeFileSync(file, encodePng(image));
module.exports = { encodePng, decodePng, writePng };
