import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STAGE, apply, clampPlacement, compose, coverPlacement, faceBox, placementMatrix, textureMatrix, uvToStage, zoomAbout,
} from '../src/alignment.ts';
import { buildFace, coverage, downscale, insideDistance, grain, photoMask, recolor, resample, skinTone, stylize } from '../src/texture.ts';
import { blendSide, flip, hairTone, matchTone, mirrorProfile, panelMask, sideMask, wrapSides } from '../src/sides.ts';
import type { FaceProfile, Pixels, Point, Rgb, SideProfile } from '../src/types.ts';

const profile: FaceProfile = JSON.parse(fs.readFileSync(new URL('../../assets/ps1_face_profile.json', import.meta.url), 'utf8'));
const side: SideProfile = JSON.parse(fs.readFileSync(new URL('../../assets/ps1_side_profile.json', import.meta.url), 'utf8'));
const close = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} is not close to ${b}`));

function image(width: number, height: number, color: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const pixel = (p: Pixels, [u, v]: Point) => {
  const i = (Math.floor(v * p.height) * p.width + Math.floor(u * p.width)) * 4;
  return [...p.data.subarray(i, i + 4)];
};

test('cover placement fills the stage and centers the photo', () => {
  for (const [w, h] of [[1280, 720], [720, 1280], [600, 800]]) {
    const m = placementMatrix(coverPlacement(w, h), w, h);
    close(apply(m, [w / 2, h / 2]), [STAGE.width / 2, STAGE.height / 2]);
    const [x0, y0] = apply(m, [0, 0]), [x1, y1] = apply(m, [w, h]);
    assert.ok(x0 <= 1e-9 && y0 <= 1e-9 && x1 >= STAGE.width - 1e-9 && y1 >= STAGE.height - 1e-9);
  }
});

test('a photo aligned to the blueprint lands on the texture landmarks', () => {
  const box = faceBox(profile), w = 1280, h = 960;
  const placement = { x: 31, y: -22, scale: 0.9, rotation: 12, stretch: 1.1 };
  const toStage = placementMatrix(placement, w, h), toTexture = compose(textureMatrix(box, 128), toStage);
  const [a, b, c, d, e, f] = toStage, det = a * d - b * c;
  for (const uv of Object.values(profile.landmarksUv)) {
    const [sx, sy] = uvToStage(uv, box);
    // The photo pixel shown under this blueprint landmark...
    const px: Point = [(d * (sx - e) - c * (sy - f)) / det, (a * (sy - f) - b * (sx - e)) / det];
    close(apply(toTexture, px), [uv[0] * 128, uv[1] * 128], 1e-6); // ...must land on it in the texture.
  }
});

test('the face box keeps the head’s real proportions', () => {
  const box = faceBox(profile);
  close([box.width / box.height], [profile.surfaceAspect]);
  assert.ok(box.x > 0 && box.y > 0);
});

test('mirrored preview alignment survives capture: the blueprint is symmetric', () => {
  for (const [u, v] of [...profile.outlineUv, ...profile.ovalUv]) {
    assert.ok([...profile.outlineUv, ...profile.ovalUv].some(([u2, v2]) => Math.hypot(1 - u - u2, v - v2) < 0.001), `no mirror image for ${u},${v}`);
  }
  close([profile.landmarksUv.eyeViewerLeft[0]], [1 - profile.landmarksUv.eyeViewerRight[0]]);
});

test('zooming and turning keep the point under the cursor fixed', () => {
  const w = 1000, h = 800, at: Point = [140, 620];
  for (const stretch of [1, 1.2]) {
    const before = { x: 12, y: 40, scale: 1.1, rotation: -8, stretch };
    const [a, b, c, d, e, f] = placementMatrix(before, w, h), det = a * d - b * c;
    const px: Point = [(d * (at[0] - e) - c * (at[1] - f)) / det, (a * (at[1] - f) - b * (at[0] - e)) / det];
    close(apply(placementMatrix(zoomAbout(before, at, 1.35, 9), w, h), px), at, 1e-6);
  }
});

test('placement is clamped to sane limits', () => {
  const p = clampPlacement({ x: 1e6, y: -1e6, scale: 99, rotation: 170, stretch: 9 }, 1);
  assert.deepEqual([p.scale, p.rotation, p.stretch], [6, 45, 1.3]);
  assert.ok(Number.isFinite(p.x) && Math.abs(p.x) < 5000);
});

test('downscale averages color without letting empty pixels darken it', () => {
  const half = image(4, 4, x => (x % 2 ? [200, 100, 50, 255] : [0, 0, 0, 0]));
  assert.deepEqual([...downscale(half, 2).data.subarray(0, 4)], [200, 100, 50, 128]);
});

test('mask is full on every facial landmark and empty outside the face', () => {
  const mask = photoMask(profile, 128), at = ([u, v]: Point) => mask[Math.floor(v * 128) * 128 + Math.floor(u * 128)];
  for (const name of ['eyeViewerLeft', 'eyeViewerRight', 'noseTip', 'mouth'] as const) {
    assert.ok(at(profile.landmarksUv[name]) > 0.98, `${name}: ${at(profile.landmarksUv[name])}`);
  }
  assert.equal(at([0.01, 0.95]), 0);
  assert.equal(at([0.99, 0.95]), 0);
  for (const u of [0.15, 0.85]) assert.ok(at([u, 0.88]) < 0.02, 'photo background must not reach the jaw corners');
});

const full = (c: Rgb) => image(128, 128, () => [...c, 255]);

test('skin tone is right across tones and ignores dark glasses', () => {
  for (const tone of [[92, 60, 44], [141, 92, 66], [198, 140, 106], [240, 204, 182]] as Rgb[]) {
    assert.deepEqual(skinTone(full(tone), profile), tone);
    const [, eyeV] = profile.landmarksUv.eyeViewerLeft;
    const glasses = image(128, 128, (_, y) => (Math.abs(y / 128 - eyeV) < 0.06 ? [20, 20, 20, 255] : [...tone, 255]));
    close(skinTone(glasses, profile)!, tone, 6);
  }
});

test('the face oval lies inside the avatar’s face panel', () => {
  for (const p of profile.ovalUv) assert.ok(insideDistance(p, profile.outlineUv) > 0, `${p} is outside the panel`);
});

test('skin tone is null when the photo misses the face', () => {
  assert.equal(skinTone(image(128, 128, () => [0, 0, 0, 0]), profile), null);
});

test('pasting keeps the photo in the face, skin at the edges and hair on top', () => {
  const mask = photoMask(profile, 128), tone: Rgb = [100, 60, 40];
  const hair = image(128, 128, (_, y) => [10, 20, 30, y < 20 ? 255 : 0]);
  const out = buildFace(full([0, 200, 0]), mask, tone, hair, true, 'smooth');
  assert.deepEqual(pixel(out, profile.landmarksUv.noseTip), [0, 200, 0, 255]);
  assert.deepEqual(pixel(out, [0.01, 0.95]), [100, 60, 40, 255]);
  assert.deepEqual(pixel(out, [0.5, 0.05]), [10, 20, 30, 255]);
  const own = buildFace(full([0, 200, 0]), mask, tone, hair, false, 'smooth');
  assert.deepEqual(pixel(own, [0.5, 0.145]), [0, 200, 0, 255], 'own hair shows inside the oval');
  assert.deepEqual(pixel(own, [0.05, 0.05]), [10, 20, 30, 255], 'no photo background above the head');
});

const SKINS: Rgb[] = [[92, 60, 44], [141, 92, 66], [198, 140, 106], [240, 204, 182]];
const average = (p: Pixels) => [0, 1, 2].map(k => p.data.reduce((sum, v, i) => (i % 4 === k ? sum + v : sum), 0) / (p.data.length / 4));

test('the retro look has square pixels, few rows and 15-bit color', () => {
  const photo = image(128, 128, (px, py) => [(px * 7 + py * 13) % 256, (px * 3) % 256, (py * 5) % 256, 255]);
  const retro = stylize(photo, 'retro', profile.surfaceAspect, [198, 140, 106]), chunky = stylize(photo, 'chunky', 1, [198, 140, 106]);
  assert.deepEqual([retro.width, retro.height], [42, 64]);
  assert.deepEqual([chunky.width, chunky.height], [44, 44]);
  for (let i = 0; i < retro.data.length; i++) {
    const level = retro.data[i] * 31 / 255;
    assert.ok(i % 4 === 3 || Math.abs(level - Math.round(level)) < 0.07);
  }
  assert.deepEqual(stylize(photo, 'smooth', 1, [1, 2, 3]).data, photo.data);
});

test('plain skin keeps its color in every look, so the face still matches the neck', () => {
  for (const skin of SKINS) for (const look of ['retro', 'chunky'] as const) close(average(stylize(full(skin), look, 1, skin)), skin, 5);
});

test('eyes and mouth stay clearly visible after pixelating', () => {
  for (const skin of SKINS) {
    const at = (p: Pixels, uv: Point) => { const c = pixel(p, uv); return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; };
    const photo = image(128, 128, (px, py) => {
      const u = px / 128, v = py / 128, L = profile.landmarksUv, near = ([a, b]: Point, rx: number, ry: number) => Math.hypot((u - a) / rx, (v - b) / ry) < 1;
      const k = near(L.eyeViewerLeft, 0.06, 0.03) || near(L.eyeViewerRight, 0.06, 0.03) || near(L.mouth, 0.12, 0.02) ? 0.45 : 1;
      return [skin[0] * k, skin[1] * k, skin[2] * k, 255];
    });
    for (const look of ['retro', 'chunky'] as const) {
      const out = stylize(photo, look, profile.surfaceAspect, skin), cheek = at(out, [0.25, 0.75]);
      for (const spot of [profile.landmarksUv.eyeViewerLeft, profile.landmarksUv.eyeViewerRight, profile.landmarksUv.mouth]) {
        assert.ok(at(out, spot) < cheek * 0.7, `${look}: feature ${at(out, spot)} vs cheek ${cheek}`);
      }
    }
  }
});

test('one part of the face does not change how another is drawn, so mouths do not flicker', () => {
  const neutral = image(128, 128, (px, py) => [150 + px % 9, 100 + py % 7, 80, 255]);
  const talking = image(128, 128, (px, py) => (py > 100 ? [30, 10, 10, 255] : [150 + px % 9, 100 + py % 7, 80, 255]));
  const a = stylize(neutral, 'retro', 1, [150, 100, 80]), b = stylize(talking, 'retro', 1, [150, 100, 80]);
  assert.deepEqual(a.data.subarray(0, 64 * 48 * 4), b.data.subarray(0, 64 * 48 * 4));
});

test('hair on top lines up in the low-resolution face', () => {
  const hair = image(128, 128, (_, py) => [10, 20, 30, py < 32 ? 255 : 0]);
  const out = buildFace(full([198, 140, 106]), photoMask(profile, 128), [198, 140, 106], hair, true, 'retro', profile.surfaceAspect);
  assert.deepEqual([out.width, out.height], [42, 64]);
  assert.deepEqual(pixel(out, [0.5, 0.2]), [10, 20, 30, 255]);
  assert.notDeepEqual(pixel(out, [0.5, 0.3]), [10, 20, 30, 255]);
});

test('resampling keeps the average color', () => {
  const photo = image(128, 128, (px, py) => [(px * 5) % 200, (py * 3) % 200, 90, 255]);
  close(average(resample(photo, 42, 64)), average(photo), 1.5);
});

test('grain is repeatable and does not shift the color', () => {
  const skin = image(64, 64, () => [196, 135, 104, 255]);
  assert.deepEqual(grain(skin).data, grain(skin).data);
  close(average(grain(skin)), [196, 135, 104], 2.5);
  assert.ok(new Set(Array.from({ length: 64 }, (_, i) => grain(skin).data[i * 4])).size > 1, 'grain is visible');
});

test('body skin follows the photo and clothes do not change', () => {
  const body = image(2, 1, x => (x ? [30, 60, 90, 255] : [196, 135, 104, 255]));
  const mask = image(2, 1, x => (x ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const out = recolor(body, mask, { from: [196, 135, 104], to: [98, 60, 52] }, null);
  assert.deepEqual([...out.data], [98, 60, 52, 255, 30, 60, 90, 255]);
  assert.equal(body.data[0], 196, 'input is untouched');
});

test('coverage reports how much of the face the photo fills', () => {
  const mask = photoMask(profile, 128);
  assert.equal(coverage(full([1, 2, 3]), mask), 1);
  const left = image(128, 128, x => [1, 2, 3, x < 64 ? 255 : 0]);
  close([coverage(left, mask)], [0.5], 0.02);
});

// --- Sides of the head --------------------------------------------------------------------------
test('hair is recolored only when asked, and clothes never change', () => {
  const body = image(3, 1, x => [[60, 31, 89, 255], [196, 135, 104, 255], [30, 60, 90, 255]][x]);
  const regions = image(3, 1, x => [[0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255]][x]);
  const out = recolor(body, regions, null, { from: [60, 31, 89], to: [30, 20, 10] });
  assert.deepEqual([...out.data], [30, 20, 10, 255, 196, 135, 104, 255, 30, 60, 90, 255]);
});

test('the side photo is full at the front edge, so it meets the face without a gap', () => {
  const mask = sideMask(side, 128), front = side.outlineUv.filter(([u, v]) => u > 0.6 && v > 0.1 && v < 0.8);
  assert.ok(front.length >= 2);
  for (const [u, v] of front) assert.ok(mask[Math.floor(v * 128) * 128 + Math.floor(u * 128)] > 0.95, `${u},${v}`);
  for (const name of ['ear', 'eye'] as const) {
    const [u, v] = side.landmarksUv[name];
    assert.ok(mask[Math.floor(v * 128) * 128 + Math.floor(u * 128)] > 0.95, name);
  }
  assert.ok(mask[Math.floor(0.7 * 128) * 128 + 10] < 0.01, 'background behind the neck is left out');
  for (const [u, v] of [[0.22, 0.02], [0.64, 0.05]]) assert.ok(mask[Math.floor(v * 128) * 128 + Math.floor(u * 128)] < 0.6, 'background above the skull fades out');
});

test('mirroring twice gives the original, and the mirrored mask is the flipped mask', () => {
  mirrorProfile(mirrorProfile(side)).ovalUv.forEach((p, i) => close(p, side.ovalUv[i]));
  const a = sideMask(side, 64), b = sideMask(mirrorProfile(side), 64);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[Math.floor(i / 64) * 64 + 63 - i % 64]) < 1e-4);
  const picture = image(5, 3, (x, y) => [x * 40, y * 60, 7, 255]);
  assert.deepEqual(flip(flip(picture)).data, picture.data);
  assert.deepEqual([...flip(picture).data.subarray(0, 4)], [160, 0, 7, 255]);
});

test('a side photo in different light is matched to the front photo’s skin', () => {
  for (const tone of [[92, 60, 44], [198, 140, 106], [240, 204, 182]] as Rgb[]) {
    const dim = image(128, 128, () => [tone[0] * 0.75, tone[1] * 0.75, tone[2] * 0.75, 255]);
    close(pixel(matchTone(dim, side, tone), side.landmarksUv.ear).slice(0, 3), tone, 3);
    close(pixel(matchTone(flip(dim), mirrorProfile(side), tone), [0.5, 0.5]).slice(0, 3), tone, 3);
  }
});

test('hair color comes from above the ear on either side', () => {
  const head = image(128, 128, (_, y) => (y < 60 ? [20, 14, 10, 255] : [190, 140, 110, 255]));
  close(hairTone(head, side)!, [20, 14, 10], 2);
  close(hairTone(flip(head), mirrorProfile(side))!, [20, 14, 10], 2);
});

test('painted hair stays on top only when chosen', () => {
  const base = image(128, 128, () => [50, 50, 50, 255]), photo = image(128, 128, () => [200, 100, 50, 255]);
  const regions = image(128, 128, (_, y) => [0, y < 64 ? 255 : 0, 0, 255]), mask = new Float32Array(128 * 128).fill(1);
  assert.deepEqual(pixel(blendSide(base, regions, photo, mask, true), [0.5, 0.2]), [50, 50, 50, 255]);
  assert.deepEqual(pixel(blendSide(base, regions, photo, mask, true), [0.5, 0.8]), [200, 100, 50, 255]);
  assert.deepEqual(pixel(blendSide(base, regions, photo, mask, false), [0.5, 0.2]), [200, 100, 50, 255]);
});

test('the front photo fades into the matching side at its edge', () => {
  const left = image(128, 128, () => [255, 0, 0, 255]), right = image(128, 128, () => [0, 0, 255, 255]);
  const wrapped = wrapSides(left, right, image(128, 128, () => [150, 150, 150, 255]));
  const out = buildFace(full([0, 200, 0]), photoMask(profile, 128), [1, 2, 3], image(128, 128, () => [0, 0, 0, 0]), false, 'smooth', 1, wrapped);
  assert.deepEqual(pixel(out, [0.02, 0.6]), [255, 0, 0, 255]);
  assert.deepEqual(pixel(out, [0.98, 0.6]), [0, 0, 255, 255]);
  assert.deepEqual(pixel(out, profile.landmarksUv.noseTip), [0, 200, 0, 255]);
});

test('wrapping reads the right column on each side', () => {
  const left = image(128, 128, x => [x, 0, 0, 255]), wrapped = wrapSides(left, flip(left), image(128, 128, () => [128, 0, 0, 255]));
  assert.ok(Math.abs(pixel(wrapped, [0.1, 0.5])[0] - 64) <= 1);
  assert.deepEqual(pixel(wrapped, [0.1, 0.5]), pixel(wrapped, [0.9, 0.5]), 'a mirrored side gives a symmetric result');
});

test('coverage of a side counts only the panel', () => {
  const panel = panelMask(side, sideMask(side, 128));
  const frontHalf = image(128, 128, x => [1, 2, 3, x < 110 ? 255 : 0]); // the panel ends well before this
  close([coverage(frontHalf, panel)], [1]);
});
