// Turns an aligned photo into avatar textures. Pure pixel work, no DOM.
import type { FaceProfile, Pixels, Point, Rgb } from './types.ts';

const blank = (width: number, height: number): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

/** Averages whole blocks; alpha-weighted so uncovered areas do not darken the edges. */
export function downscale(source: Pixels, size: number): Pixels {
  const out = blank(size, size), step = source.width / size;
  if (!Number.isInteger(step) || source.width !== source.height) throw new Error('Source must be a square multiple of the target size');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < step; sy++) {
        for (let sx = 0; sx < step; sx++) {
          const i = ((y * step + sy) * source.width + x * step + sx) * 4, alpha = source.data[i + 3];
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += alpha;
        }
      }
      out.data.set(a ? [r / a, g / a, b / a, a / (step * step)] : [0, 0, 0, 0], (y * size + x) * 4);
    }
  }
  return out;
}

/** Signed distance to a polygon, positive inside. */
export function insideDistance([x, y]: Point, polygon: Point[]): number {
  let inside = false, nearest = Infinity;
  polygon.forEach(([x1, y1], i) => {
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
    const dx = x2 - x1, dy = y2 - y1, t = clamp01(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy));
    nearest = Math.min(nearest, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
  });
  return inside ? nearest : -nearest;
}

/** How much photo to use per texel: full in the face, fading out at the edge of the oval. */
export function photoMask(profile: FaceProfile, size: number, feather = 0.09): Float32Array {
  const mask = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      mask[y * size + x] = smooth(insideDistance([(x + 0.5) / size, (y + 0.5) / size], profile.ovalUv) / feather);
    }
  }
  return mask;
}

/** Median color of the cheeks and forehead, ignoring areas the photo does not cover. */
export function skinTone(photo: Pixels, profile: FaceProfile): Rgb | null {
  const { eyeViewerLeft: l, eyeViewerRight: r, noseTip, hairline } = profile.landmarksUv;
  const cheekY = noseTip[1] - 0.04, foreheadY = (hairline[1] * 0.4 + l[1] * 0.6) - 0.06;
  const patches: [Point, number][] = [
    [[l[0] - 0.04, cheekY], 0.07], [[r[0] + 0.04, cheekY], 0.07], [[0.4, foreheadY], 0.05], [[0.6, foreheadY], 0.05]];
  const samples: Rgb[] = [];
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const u = (x + 0.5) / photo.width, v = (y + 0.5) / photo.height, i = (y * photo.width + x) * 4;
      if (photo.data[i + 3] < 250 || !patches.some(([[pu, pv], radius]) => Math.hypot(u - pu, v - pv) < radius)) continue;
      samples.push([photo.data[i], photo.data[i + 1], photo.data[i + 2]]);
    }
  }
  if (samples.length < 20) return null;
  const luma = ([a, b, c]: Rgb) => a * 0.3 + b * 0.59 + c * 0.11;
  samples.sort((a, b) => luma(a) - luma(b));
  // Average the middle half, so glasses, shadows and highlights do not pull the tone.
  const middle = samples.slice(Math.floor(samples.length / 4), Math.ceil(samples.length * 3 / 4));
  return [0, 1, 2].map(k => Math.round(middle.reduce((sum, c) => sum + c[k], 0) / middle.length)) as Rgb;
}

export type Look = 'smooth' | 'retro' | 'chunky';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Height in texels of a face or head-side texture; the width follows so pixels come out square. */
const ROWS: Record<Exclude<Look, 'smooth'>, number> = { retro: 64, chunky: 44 };
const luma = (r: number, g: number, b: number) => r * 0.3 + g * 0.59 + b * 0.11;

/** Area-averages to any smaller size. Expects an opaque image. */
export function resample(image: Pixels, width: number, height: number): Pixels {
  const out = blank(width, height), sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      let area = 0;
      for (let py = Math.floor(y * sy); py < Math.min(image.height, (y + 1) * sy); py++) {
        const h = Math.min(py + 1, (y + 1) * sy) - Math.max(py, y * sy);
        for (let px = Math.floor(x * sx); px < Math.min(image.width, (x + 1) * sx); px++) {
          const w = h * (Math.min(px + 1, (x + 1) * sx) - Math.max(px, x * sx)), i = (py * image.width + px) * 4;
          for (let k = 0; k < 3; k++) sum[k] += image.data[i + k] * w;
          area += w;
        }
      }
      out.data.set([sum[0] / area, sum[1] / area, sum[2] / area, 255], (y * width + x) * 4);
    }
  }
  return out;
}

/**
 * Big crisp pixels that still read as a face: sharpen before quantizing so eyes, brows and lips survive,
 * add contrast around the skin tone (so the skin itself still matches the neck), then reduce to a few
 * brightness steps with ordered dithering and 15-bit color. Nothing depends on the rest of the image, so
 * mouth shapes do not flicker.
 */
export function stylize(image: Pixels, look: Look, aspect: number, pivot: Rgb): Pixels {
  if (look === 'smooth') return { ...image, data: new Uint8ClampedArray(image.data) };
  const height = ROWS[look], width = Math.round(height * aspect), small = resample(image, width, height), out = blank(width, height);
  const middle = luma(...pivot), STEPS = 18, at = (x: number, y: number, k: number) =>
    small.data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4 + k];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = [0, 1, 2].map(k => {
        const c = at(x, y, k), around = (at(x - 1, y, k) + at(x + 1, y, k) + at(x, y - 1, k) + at(x, y + 1, k)) / 4;
        return (c + (c - around) * 0.9 - pivot[k]) * 1.18 + pivot[k];
      });
      const light = Math.max(1, luma(color[0], color[1], color[2]));
      const dither = ((BAYER[(y % 4) * 4 + x % 4] + 0.5) / 16 - 0.5) * 0.8;
      // Steps are counted from the skin tone, so even skin does not shift overall.
      const step = Math.round((light - middle) / 255 * STEPS + dither) / STEPS * 255 + middle, scale = Math.max(0, step) / light;
      const fine = (BAYER[((y + 2) % 4) * 4 + (x + 1) % 4] + 0.5) / 16 - 0.5;
      out.data.set([...color.map(c => Math.min(31, Math.max(0, Math.round(c * scale / 255 * 31 + fine))) * 255 / 31), 255], (y * width + x) * 4);
    }
  }
  return out;
}

/** Gives flat painted areas (skin, cloth) the grain of an old low-color texture. Repeatable per texel. */
export function grain(image: Pixels, amount = 7): Pixels {
  const out: Pixels = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const n = i / 4, x = n % image.width, y = Math.floor(n / image.width), wave = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const noise = (wave - Math.floor(wave) - 0.5) * 2 * amount;
    for (let k = 0; k < 3; k++) out.data[i + k] = Math.round(Math.min(255, Math.max(0, image.data[i + k] + noise)) / 255 * 31) * 255 / 31;
  }
  return out;
}

/**
 * Layers: skin and the outfit's hair (or `under`, if given), then the photo through its mask. With `hairOnTop` the hair goes
 * over the photo; without it, the person's own hair shows and only blends into the avatar's at the edge.
 */
export function buildFace(photo: Pixels, mask: Float32Array, tone: Rgb, hair: Pixels, hairOnTop: boolean, look: Look, aspect = 1, under: Pixels | null = null): Pixels {
  const out = blank(photo.width, photo.height);
  for (let i = 0; i < mask.length; i++) {
    const amount = mask[i] * photo.data[i * 4 + 3] / 255;
    const isHair = hair.data[i * 4 + 3] > 127;
    for (let k = 0; k < 3; k++) {
      const base = under ? under.data[i * 4 + k] : isHair ? hair.data[i * 4 + k] : tone[k];
      out.data[i * 4 + k] = base + (photo.data[i * 4 + k] - base) * amount;
    }
    out.data[i * 4 + 3] = 255;
  }
  const styled = stylize(out, look, aspect, tone);
  if (hairOnTop) {
    for (let y = 0; y < styled.height; y++) {
      for (let x = 0; x < styled.width; x++) {
        const from = (Math.floor((y + 0.5) / styled.height * hair.height) * hair.width + Math.floor((x + 0.5) / styled.width * hair.width)) * 4;
        if (hair.data[from + 3] > 127) styled.data.set(hair.data.subarray(from, from + 4), (y * styled.width + x) * 4);
      }
    }
  }
  return styled;
}

export interface Recolor { from: Rgb; to: Rgb }

/** Shifts skin (red in `regions`) and hair (green) texels to the photo's colors, keeping their shading. */
export function recolor(body: Pixels, regions: Pixels, skin: Recolor | null, hair: Recolor | null): Pixels {
  const out = { width: body.width, height: body.height, data: new Uint8ClampedArray(body.data) };
  const ratios = [skin, hair].map(change => change && change.to.map((c, k) => c / change.from[k]));
  for (let i = 0; i < out.data.length; i += 4) {
    const ratio = regions.data[i] > 127 ? ratios[0] : regions.data[i + 1] > 127 ? ratios[1] : null;
    if (ratio) for (let k = 0; k < 3; k++) out.data[i + k] = body.data[i + k] * ratio[k];
  }
  return out;
}

/** Share of the face that the photo actually covers, 0 to 1. */
export function coverage(photo: Pixels, mask: Float32Array): number {
  let covered = 0, total = 0;
  mask.forEach((m, i) => {
    total += m;
    covered += m * photo.data[i * 4 + 3] / 255;
  });
  return total ? covered / total : 0;
}
