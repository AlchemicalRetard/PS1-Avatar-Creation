// Side-of-head photos. Pure pixel work, no DOM. "Left" and "right" are as seen facing the avatar.
// The canonical side view has the nose on the right (viewer's left side); the other is its mirror image.
import { insideDistance } from './texture.ts';
import type { Pixels, Point, Rgb, SideProfile } from './types.ts';

export const SIDE_IDS = ['sideL', 'sideR'] as const;
export type SideId = (typeof SIDE_IDS)[number];
export const isSide = (id: string): id is SideId => id === 'sideL' || id === 'sideR';

export function flip(image: Pixels): Pixels {
  const { width, height } = image, data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + width - 1 - x) * 4);
    }
  }
  return { width, height, data };
}

/** A profile mirrored for the viewer's right side. */
export function mirrorProfile(profile: SideProfile): SideProfile {
  const m = (points: Point[]): Point[] => points.map(([u, v]) => [1 - u, v]);
  return {
    ...profile,
    landmarksUv: Object.fromEntries(Object.entries(profile.landmarksUv).map(([k, [u, v]]) => [k, [1 - u, v]])) as SideProfile['landmarksUv'],
    silhouetteUv: m(profile.silhouetteUv),
    ovalUv: m(profile.ovalUv),
    outlineUv: m(profile.outlineUv),
  };
}

/** How much photo to use per texel: full up to the front edge, fading at the back and under the jaw. */
export function sideMask(profile: SideProfile, size: number, feather = 0.07): Float32Array {
  const mask = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.max(0, insideDistance([(x + 0.5) / size, (y + 0.5) / size], profile.ovalUv) / feather));
      mask[y * size + x] = t * t * (3 - 2 * t);
    }
  }
  return mask;
}

/** Texels that are on the avatar, for checking that a photo covers them. */
export function panelMask(profile: SideProfile, mask: Float32Array): Float32Array {
  const size = Math.sqrt(mask.length);
  return mask.map((m, i) => (insideDistance([(i % size + 0.5) / size, (Math.floor(i / size) + 0.5) / size], profile.outlineUv) > 0 ? m : 0));
}

/** Average color of the middle half, by brightness, of the covered pixels within circles. */
function patchColor(image: Pixels, patches: [Point, number][]): Rgb | null {
  const samples: Rgb[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const u = (x + 0.5) / image.width, v = (y + 0.5) / image.height, i = (y * image.width + x) * 4;
      if (image.data[i + 3] < 250 || !patches.some(([[pu, pv], r]) => Math.hypot(u - pu, v - pv) < r)) continue;
      samples.push([image.data[i], image.data[i + 1], image.data[i + 2]]);
    }
  }
  if (samples.length < 20) return null;
  const luma = ([a, b, c]: Rgb) => a * 0.3 + b * 0.59 + c * 0.11;
  samples.sort((a, b) => luma(a) - luma(b));
  const middle = samples.slice(Math.floor(samples.length / 4), Math.ceil(samples.length * 3 / 4));
  return [0, 1, 2].map(k => Math.round(middle.reduce((sum, c) => sum + c[k], 0) / middle.length)) as Rgb;
}

/** Matches a side photo's skin to the front photo's, since turning the head changes the light. */
export function matchTone(photo: Pixels, profile: SideProfile, tone: Rgb): Pixels {
  const { ear, mouth, eye } = profile.landmarksUv;
  const cheek: Point = [ear[0] * 0.45 + eye[0] * 0.55, mouth[1] - 0.11], jaw: Point = [cheek[0] - (eye[0] - ear[0]) * 0.1, mouth[1] - 0.02];
  const skin = patchColor(photo, [[cheek, 0.055], [jaw, 0.045]]);
  const gain = skin ? tone.map((c, k) => Math.min(1.7, Math.max(0.6, c / Math.max(1, skin[k])))) : [1, 1, 1];
  const data = new Uint8ClampedArray(photo.data);
  for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) data[i + k] = photo.data[i + k] * gain[k];
  return { width: photo.width, height: photo.height, data };
}

/** The person's hair color, from above the ear. (Scalp color if the head is shaved, which is right too.) */
export function hairTone(photo: Pixels, profile: SideProfile): Rgb | null {
  const { ear } = profile.landmarksUv, toFront = Math.sign(profile.landmarksUv.eye[0] - ear[0]);
  return patchColor(photo, [[[ear[0] - toFront * 0.05, ear[1] - 0.3], 0.07], [[ear[0] - toFront * 0.14, ear[1] - 0.2], 0.05]]);
}

/** The avatar's painted side with the photo over it. With `hairOnTop` the painted hair stays above. */
export function blendSide(base: Pixels, regions: Pixels, photo: Pixels, mask: Float32Array, hairOnTop: boolean): Pixels {
  const out: Pixels = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
  for (let i = 0; i < mask.length; i++) {
    if (hairOnTop && regions.data[i * 4 + 1] > 127) continue;
    const amount = mask[i] * photo.data[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) out.data[i * 4 + k] = base.data[i * 4 + k] + (photo.data[i * 4 + k] - base.data[i * 4 + k]) * amount;
  }
  return out;
}

/**
 * Wraps the sides around onto the front of the face, so the front photo fades into them at its edge.
 * `depth` holds, for each face texel, the column of the canonical side texture at the same spot.
 */
export function wrapSides(left: Pixels, right: Pixels, depth: Pixels): Pixels {
  const { width, height } = depth, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, onLeft = x < width / 2, source = onLeft ? left : right;
      const column = Math.round(depth.data[i] / 255 * (source.width - 1));
      const from = (y * source.width + (onLeft ? column : source.width - 1 - column)) * 4;
      data.set(source.data.subarray(from, from + 4), i);
    }
  }
  return { width, height, data };
}
