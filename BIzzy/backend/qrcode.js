'use strict';
// =====================================================================
// Business OS — vendored pure-JS QR Code generator (Updates Stage A).
// Why vendored: the app has a HARD offline rule (zero external calls,
// no CDN) and no QR package is among the installed dependencies, so the
// QR for UPI payments is generated right here — server-side, locally,
// from the payload string alone. No network, no native code.
//
// Scope (deliberately small, but complete and spec-faithful):
//   - Byte mode only (payloads are ASCII UPI URIs), UTF-8 encoded.
//   - Error-correction level L — plenty for a clean screen/print scan,
//     and it keeps the symbol small for ~120-char UPI payloads.
//   - Versions 1–10, auto-selected (smallest that fits).
//   - Full mask evaluation (all 8 masks, ISO penalty rules) and
//     Reed–Solomon error correction over GF(256).
// Output: the module matrix, or an inline SVG string (black modules on
// white, 4-module quiet zone) that the frontend embeds as-is.
// =====================================================================

// ---------- GF(256) arithmetic (primitive polynomial 0x11d) ----------
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(x, y) {
  return x !== 0 && y !== 0 ? GF_EXP[GF_LOG[x] + GF_LOG[y]] : 0;
}

// ---------- Reed–Solomon (Nayuki-style divisor/remainder) ----------
function rsComputeDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[result.length - 1] = 1; // start with monomial x^0
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsComputeRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ---------- Static tables for ECC level L, versions 1–10 ----------
// groups: [blockCount, dataCodewordsPerBlock] pairs (shorter blocks first).
const ECC_L_BLOCKS = [
  null,
  { ecPerBlock: 7, groups: [[1, 19]] },
  { ecPerBlock: 10, groups: [[1, 34]] },
  { ecPerBlock: 15, groups: [[1, 55]] },
  { ecPerBlock: 20, groups: [[1, 80]] },
  { ecPerBlock: 26, groups: [[1, 108]] },
  { ecPerBlock: 18, groups: [[2, 68]] },
  { ecPerBlock: 20, groups: [[2, 78]] },
  { ecPerBlock: 24, groups: [[2, 97]] },
  { ecPerBlock: 30, groups: [[2, 116]] },
  { ecPerBlock: 18, groups: [[2, 68], [2, 69]] }
];
const ALIGNMENT_CENTERS = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50]
];
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 2]; // index = version

function totalDataCodewords(version) {
  return ECC_L_BLOCKS[version].groups.reduce((s, [n, len]) => s + n * len, 0);
}

// ---------- Bit buffer ----------
function makeBitBuffer() {
  const bits = [];
  return {
    put(value, length) { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); },
    putBytes(bytes) { for (const b of bytes) this.put(b, 8); },
    get length() { return bits.length; },
    toBytes() {
      const out = [];
      for (let i = 0; i < bits.length; i += 8) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] || 0);
        out.push(v);
      }
      return out;
    }
  };
}

// Encode the payload into the final interleaved codeword sequence.
function encodeCodewords(bytes) {
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v >= 10 ? 16 : 8;
    if (4 + countBits + bytes.length * 8 <= totalDataCodewords(v) * 8) { version = v; break; }
  }
  if (!version) return null; // payload too long for version 10-L
  const dataCapBits = totalDataCodewords(version) * 8;
  const bb = makeBitBuffer();
  bb.put(0x4, 4); // byte mode
  bb.put(bytes.length, version >= 10 ? 16 : 8);
  bb.putBytes(bytes);
  bb.put(0, Math.min(4, dataCapBits - bb.length)); // terminator
  bb.put(0, (8 - (bb.length % 8)) % 8); // align to byte
  for (let pad = 0xec; bb.length < dataCapBits; pad ^= 0xec ^ 0x11) bb.put(pad, 8);
  const dataBytes = bb.toBytes();

  // Split into blocks, compute ECC per block, interleave.
  const spec = ECC_L_BLOCKS[version];
  const divisor = rsComputeDivisor(spec.ecPerBlock);
  const blocks = [];
  let offset = 0;
  for (const [count, len] of spec.groups) {
    for (let k = 0; k < count; k++) {
      const blockData = dataBytes.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: blockData, ecc: rsComputeRemainder(blockData, divisor) });
    }
  }
  const result = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const b of blocks) result.push(b.ecc[i]);
  }
  return { version, codewords: result };
}

// ---------- Matrix construction ----------
function getFormatBits(mask) {
  // ECC level L has format indicator bits 01.
  const data = (0x1 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function getVersionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}
function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

const MASK_FUNCTIONS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function buildMatrix(version, codewords, mask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  function setFn(x, y, dark) {
    if (x >= 0 && x < size && y >= 0 && y < size) { modules[y][x] = dark; isFunction[y][x] = true; }
  }
  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder patterns with separators
  function drawFinder(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx; const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  // Alignment patterns
  const centers = ALIGNMENT_CENTERS[version];
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const isCorner = (i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0);
      if (isCorner) continue;
      const cx = centers[j]; const cy = centers[i];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Reserve format areas (drawn after data, below) + dark module
  function drawFormat(maskVal) {
    const data = getFormatBits(maskVal);
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(data, i));
    setFn(8, 7, getBit(data, 6));
    setFn(8, 8, getBit(data, 7));
    setFn(7, 8, getBit(data, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(data, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(data, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(data, i));
    setFn(8, size - 8, true);
  }
  drawFormat(0); // placeholder — reserves the modules as function modules
  // Version information (versions 7+)
  if (version >= 7) {
    const bits = getVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      setFn(size - 11 + (i % 3), Math.floor(i / 3), bit);
      setFn(Math.floor(i / 3), size - 11 + (i % 3), bit);
    }
  }
  // Data placement (zigzag), with the mask applied to data modules only.
  const maskFn = MASK_FUNCTIONS[mask];
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[y][x]) continue;
        let dark = false;
        if (bitIndex < codewords.length * 8) {
          dark = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        } else {
          bitIndex++; // remainder bit — stays light, still masked below
        }
        if (maskFn(y, x)) dark = !dark;
        modules[y][x] = dark;
      }
    }
  }
  drawFormat(mask); // real format information for the chosen mask
  return modules;
}

// ---------- Mask penalty scoring (ISO rules) ----------
function penaltyScore(m) {
  const size = m.length;
  let score = 0;
  // Rule 1: runs of >= 5 same-color modules in rows/columns
  for (let y = 0; y < size; y++) {
    let runColor = m[y][0]; let runLen = 1;
    for (let x = 1; x < size; x++) {
      if (m[y][x] === runColor) { runLen++; } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = m[y][x]; runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let x = 0; x < size; x++) {
    let runColor = m[0][x]; let runLen = 1;
    for (let y = 1; y < size; y++) {
      if (m[y][x] === runColor) { runLen++; } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = m[y][x]; runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  // Rule 2: 2x2 blocks of the same color
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3;
    }
  }
  // Rule 3: finder-like pattern 1011101 with a 4-module light run on
  // either side — checked as an 11-bit sliding window (10111010000 or
  // 00001011101), the standard formulation.
  for (let y = 0; y < size; y++) {
    let bits = 0;
    for (let x = 0; x < size; x++) {
      bits = ((bits << 1) & 0x7ff) | (m[y][x] ? 1 : 0);
      if (x >= 10 && (bits === 0x5d0 || bits === 0x05d)) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    let bits = 0;
    for (let y = 0; y < size; y++) {
      bits = ((bits << 1) & 0x7ff) | (m[y][x] ? 1 : 0);
      if (y >= 10 && (bits === 0x5d0 || bits === 0x05d)) score += 40;
    }
  }
  // Rule 4: proportion of dark modules away from 50%
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  if (k > 0) score += k * 10;
  return score;
}

// ---------- Public API ----------
function encodeQr(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const enc = encodeCodewords(bytes);
  if (!enc) return null;
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = buildMatrix(enc.version, enc.codewords, mask);
    const s = penaltyScore(modules);
    if (s < bestScore) { bestScore = s; best = modules; }
  }
  return { version: enc.version, size: best.length, modules: best };
}

function qrSvg(text) {
  const qr = encodeQr(text);
  if (!qr) return null;
  const quiet = 4;
  const dim = qr.size + quiet * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="UPI payment QR"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}

module.exports = { encodeQr, qrSvg };
