// Combines a mouth-shape photo with the neutral face. Pure pixel work, no DOM.
import type { FaceProfile, Pixels } from './types.ts';

const luma = (p: Pixels, i: number) => p.data[i] * 0.3 + p.data[i + 1] * 0.59 + p.data[i + 2] * 0.11;

/** Soft region around the mouth and chin: the only part of the face that changes while talking. */
export function mouthMask(profile: FaceProfile, size: number): Float32Array {
  const mask = new Float32Array(size * size), { noseTip, mouth } = profile.landmarksUv;
  const top = noseTip[1] + 0.012, rx = 0.36, cy = mouth[1] + 0.06, ry = cy - top;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const r = Math.hypot((u - 0.5) / rx, (v - cy) / (v > cy ? ry * 1.1 : ry));
      const t = Math.min(1, Math.max(0, (1 - r) / 0.35));
      mask[y * size + x] = t * t * (3 - 2 * t);
    }
  }
  return mask;
}

/** The neutral face with this photo's mouth, its color matched around the edge of the mouth region. */
export function blendMouth(neutral: Pixels, shape: Pixels, mask: Float32Array): Pixels {
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < 0.02 || mask[i] > 0.6 || neutral.data[i * 4 + 3] < 250 || shape.data[i * 4 + 3] < 250) continue;
    for (let k = 0; k < 3; k++) {
      a[k] += neutral.data[i * 4 + k];
      b[k] += shape.data[i * 4 + k];
    }
  }
  const gain = a.map((sum, k) => (b[k] ? Math.min(1.7, Math.max(0.6, sum / b[k])) : 1));
  const out: Pixels = { width: neutral.width, height: neutral.height, data: new Uint8ClampedArray(neutral.data) };
  for (let i = 0; i < mask.length; i++) {
    const amount = mask[i] * shape.data[i * 4 + 3] / 255;
    if (!amount) continue;
    for (let k = 0; k < 3; k++) {
      const n = neutral.data[i * 4 + k], s = Math.min(255, shape.data[i * 4 + k] * gain[k]);
      out.data[i * 4 + k] = n + (s - n) * amount;
    }
  }
  return out;
}

/**
 * How far to move `shape`, in texels, so its eyes and nose line up with `neutral`: heads move between
 * shots. Returns null when nothing matches well enough to trust.
 */
export function findShift(neutral: Pixels, shape: Pixels, profile: FaceProfile, range = 12): [number, number] | null {
  const size = neutral.width, { eyeViewerLeft: l, eyeViewerRight: r, noseTip } = profile.landmarksUv;
  // The mouth is left out on purpose: it is supposed to differ.
  const x0 = Math.round((l[0] - 0.13) * size), x1 = Math.round((r[0] + 0.13) * size);
  const y0 = Math.round((l[1] - 0.13) * size), y1 = Math.round((noseTip[1] + 0.02) * size);
  let best = { score: -Infinity, dx: 0, dy: 0 };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const sx = x - dx, sy = y - dy;
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          const i = (y * size + x) * 4, j = (sy * size + sx) * 4;
          if (neutral.data[i + 3] < 250 || shape.data[j + 3] < 250) continue;
          const a = luma(neutral, i), b = luma(shape, j);
          n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
        }
      }
      if (n < (x1 - x0) * (y1 - y0) * 0.6) continue;
      const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
      if (va < n || vb < n) continue; // flat areas carry no information
      // Correlation ignores exposure differences; prefer the smaller move when scores tie.
      const score = (sab - sa * sb / n) / Math.sqrt(va * vb) - Math.hypot(dx, dy) * 1e-5;
      if (score > best.score) best = { score, dx, dy };
    }
  }
  const atEdge = Math.abs(best.dx) === range || Math.abs(best.dy) === range;
  return best.score > 0.6 && !atEdge ? [best.dx, best.dy] : null;
}
