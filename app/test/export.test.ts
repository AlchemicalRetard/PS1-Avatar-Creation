import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { clipSize } from '../src/clip.ts';
import { replaceTextures } from '../src/glb.ts';

const require = createRequire(import.meta.url);
const validator = require('gltf-validator'), { encodePng, decodePng } = require('../../tools/lib/png.js');
const outfits = JSON.parse(fs.readFileSync(new URL('../../assets/ps1_outfits.json', import.meta.url), 'utf8'));
const load = (file: string) => new Uint8Array(fs.readFileSync(new URL(`../../assets/${file}`, import.meta.url)));
const flat = (width: number, height: number, color: number[]) =>
  new Uint8Array(encodePng({ width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => color[i % 4]) }));

const parse = (glb: Uint8Array) => {
  const view = new DataView(glb.buffer, glb.byteOffset), end = 20 + view.getUint32(12, true);
  return { json: JSON.parse(new TextDecoder().decode(glb.subarray(20, end))), bin: glb.subarray(end + 8) };
};
const bytesOf = (glb: Uint8Array, i: number) => {
  const { json, bin } = parse(glb), v = json.bufferViews[i];
  return Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
};
const imageOf = (glb: Uint8Array, name: string) => {
  const { json } = parse(glb), m = json.materials.find((x: { name: string }) => x.name === name);
  return json.images[json.textures[m.pbrMetallicRoughness.baseColorTexture.index].source];
};

for (const outfit of outfits) {
  const original = load(outfit.files.glb);
  const pngs = new Map([['Face_Photo', flat(51, 64, [200, 10, 20, 255])], ['Body', flat(256, 256, [1, 2, 3, 255])], ['Side_ViewerLeft', flat(49, 64, [9, 99, 9, 255])]]);
  const made = replaceTextures(original, pngs);

  test(`${outfit.id}: the downloaded model is valid`, async () => {
    const report = await validator.validateBytes(made), before = await validator.validateBytes(original);
    const codes = (r: typeof report) => [...new Set(r.issues.messages.filter((m: { severity: number }) => m.severity <= 1).map((m: { code: string }) => m.code))];
    assert.equal(report.issues.numErrors, 0);
    assert.deepEqual(codes(report), codes(before));
  });

  test(`${outfit.id}: the new textures are in it, and the others are untouched`, () => {
    for (const [name, png] of pngs) assert.deepEqual(bytesOf(made, imageOf(made, name).bufferView), Buffer.from(png));
    const face = decodePng(bytesOf(made, imageOf(made, 'Face_Photo').bufferView));
    assert.deepEqual([face.width, face.height, ...face.data.subarray(0, 4)], [51, 64, 200, 10, 20, 255]);
    const changed = new Set([...pngs.keys()].map(n => imageOf(original, n).bufferView));
    parse(original).json.bufferViews.forEach((_: unknown, i: number) => {
      if (!changed.has(i)) assert.ok(bytesOf(made, i).equals(bytesOf(original, i)), `buffer view ${i} changed`);
    });
  });

  test(`${outfit.id}: skeleton, geometry, animation and credit are kept`, () => {
    const a = parse(original).json, b = parse(made).json;
    for (const key of ['asset', 'nodes', 'meshes', 'skins', 'accessors', 'animations', 'materials', 'samplers', 'scenes']) assert.deepEqual(b[key], a[key], key);
    assert.match(b.asset.copyright, /MR_Fisher.*CC BY 4\.0/);
  });

  test(`${outfit.id}: the original file is not modified in memory`, () => {
    assert.deepEqual(original, load(outfit.files.glb));
  });
}

test('works on a GLB that does not start at the beginning of its buffer', () => {
  const file = load(outfits[0].files.glb), shifted = new Uint8Array(file.length + 4);
  shifted.set(file, 4);
  const pngs = new Map([['Body', flat(4, 4, [1, 2, 3, 255])]]);
  assert.deepEqual(replaceTextures(shifted.subarray(4), pngs), replaceTextures(file, pngs));
});

test('bad input is refused', () => {
  assert.throws(() => replaceTextures(new Uint8Array(100), new Map()), /GLB/);
  assert.throws(() => replaceTextures(new Uint8Array(3), new Map()), /GLB/);
  assert.throws(() => replaceTextures(load(outfits[0].files.glb), new Map([['Nose', new Uint8Array(1)]])), /Nose/);
});

test('video sizes are even, as H.264 needs, and whole multiples of the retro picture', () => {
  assert.deepEqual(clipSize('portrait', 1080), [1080, 1920]);
  assert.deepEqual(clipSize('square', 1080), [1080, 1080]);
  assert.deepEqual(clipSize('landscape', 540), [960, 540]);
  for (const shape of ['portrait', 'square', 'landscape'] as const) {
    for (const side of [1080, 540]) {
      for (const n of clipSize(shape, side)) assert.equal(n % 2 + (n * 270 / side) % 1, 0);
    }
  }
});
