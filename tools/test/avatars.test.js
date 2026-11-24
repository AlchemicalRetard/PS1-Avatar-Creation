// Checks the built GLBs as a viewer would show them. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validator = require('gltf-validator');
const { readGlb, readAccessor, worldTriangles } = require('../lib/gltf');
const { render, sample, loadImages, faceNormal } = require('../lib/raster');
const { encodePng, decodePng } = require('../lib/png');
const { FACE_PROFILE, faceUv, exportProfile, exportSideProfile } = require('../lib/face_profile');
const { OUTFITS } = require('../build_avatars');

const assets = path.resolve(__dirname, '../../assets');
const files = Object.fromEntries(OUTFITS.map(o => [o.id, o.files.glb]));
const models = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readGlb(path.join(assets, f))]));
const tris = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, worldTriangles(m)]));

const span = (points, k) => Math.max(...points.map(p => p[k])) - Math.min(...points.map(p => p[k]));
const distance = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));

// Four marker colors, one per quadrant of the face image: TL red, TR green, BL blue, BR yellow.
const QUADRANTS = { tl: [255, 0, 0], tr: [0, 255, 0], bl: [0, 0, 255], br: [255, 255, 0] };
function quadrantImage(size) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data.set([...QUADRANTS[(y < size / 2 ? 't' : 'b') + (x < size / 2 ? 'l' : 'r')], 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

// Draws the front view with the marker image as the face and returns where each color appears.
function quadrantCenters(name, faceMaterial) {
  const model = models[name], material = model.gltf.materials.findIndex(m => m.name === faceMaterial);
  const index = model.gltf.materials[material].pbrMetallicRoughness.baseColorTexture.index;
  const images = loadImages(model);
  images[model.gltf.textures[index].source] = quadrantImage(64);
  const r = render(model, { triangles: tris[name], images, size: 800 });
  const sums = Object.fromEntries(Object.keys(QUADRANTS).map(k => [k, [0, 0, 0]]));
  r.hit.forEach((t, i) => {
    if (!t || t.material !== material) return;
    const color = Array.from(r.data.subarray(i * 4, i * 4 + 3));
    const key = Object.keys(QUADRANTS).find(k => distance(QUADRANTS[k], color) < 5);
    sums[key][0] += i % r.width;
    sums[key][1] += Math.floor(i / r.width);
    sums[key][2] += 1;
  });
  return Object.fromEntries(Object.entries(sums).map(([k, [x, y, n]]) => {
    assert.ok(n > 0, `${k} quadrant of the face image is not visible from the front`);
    return [k, [x / n, y / n]];
  }));
}

for (const name of Object.keys(files)) {
  test(`${name}: passes the Khronos glTF validator`, async () => {
    const report = await validator.validateBytes(new Uint8Array(fs.readFileSync(path.join(assets, files[name]))));
    // Errors and warnings. The source rig nests its skinned mesh, which viewers handle fine.
    const allowed = ['NODE_SKINNED_MESH_NON_ROOT'];
    const problems = report.issues.messages.filter(m => m.severity <= 1 && !allowed.includes(m.code));
    const lines = problems.slice(0, 5).map(m => `${m.code} ${m.pointer || ''} ${m.message}`);
    assert.equal(problems.length, 0, lines.join('\n'));
  });

  test(`${name}: vertices are finite and the avatar stands upright`, () => {
    const points = tris[name].flatMap(t => t.world);
    assert.ok(points.flat().every(Number.isFinite), 'non-finite vertex');
    assert.ok(span(points, 1) > span(points, 0) && span(points, 1) > span(points, 2), 'Y must be the tallest axis');
  });

  test(`${name}: a face image appears upright and unmirrored from the front`, () => {
    const c = quadrantCenters(name, 'Face_Photo');
    assert.ok(c.tl[0] < c.tr[0] && c.bl[0] < c.br[0], 'image left must be on the viewer left');
    assert.ok(c.tl[1] < c.bl[1] && c.tr[1] < c.br[1], 'image top must be at the top');
  });

  test(`${name}: keeps the source rig and animation`, () => {
    const source = JSON.parse(fs.readFileSync(path.join(assets, 'reference_base_ps1/scene.gltf'), 'utf8'));
    const { gltf } = models[name];
    assert.deepEqual(gltf.skins.map(s => s.joints), source.skins.map(s => s.joints));
    assert.deepEqual(gltf.nodes, source.nodes);
    assert.equal(gltf.animations[0].channels.length, source.animations[0].channels.length);
    assert.equal(tris[name].filter(t => !/Skirt|Collar/.test(models[name].gltf.materials[t.material].name)).length, source.accessors[source.meshes[0].primitives[0].indices].count / 3);
  });

  test(`${name}: credits the CC BY author inside the file`, () => {
    assert.match(models[name].gltf.asset.copyright, /MR_Fisher.*CC BY 4\.0/);
  });

  test(`${name}: face panel is one seam-free island inside the texture`, () => {
    const face = tris[name].filter(t => t.material === 1), uvAt = new Map();
    assert.equal(face.length, 14);
    for (const t of face) {
      t.bind.forEach((p, i) => {
        assert.ok(t.uv[i].every(v => v >= 0 && v <= 1), 'UV outside the texture');
        const key = p.map(v => v.toFixed(5)).join(), uv = t.uv[i].map(v => v.toFixed(5)).join();
        assert.equal(uvAt.get(key) ?? uv, uv, `seam at ${key}`);
        uvAt.set(key, uv);
      });
    }
  });

  test(`${name}: placeholder facial features sit at the profile landmarks`, () => {
    const image = loadImages(models[name])[1], L = FACE_PROFILE.landmarks;
    assert.equal(image.width, FACE_PROFILE.textureSize);
    const pixel = p => sample(image, faceUv(p));
    for (const eye of [L.eyeViewerLeft, L.eyeViewerRight]) {
      assert.ok(Math.max(...pixel(eye)) < 70, 'pupil should be dark');
      assert.ok(Math.min(...pixel([eye[0] + 0.03, eye[1]])) > 150, 'eye white beside the pupil');
    }
    const forehead = pixel([0, 5.6]);
    assert.ok(distance(forehead, pixel(L.mouth)) > 30, 'mouth should differ from skin');
    const faceY = tris[name].filter(t => t.material === 1).flatMap(t => t.bind.map(p => p[1]));
    for (const [x, y] of Object.values(L)) {
      assert.ok(y > Math.min(...faceY) && y < Math.max(...faceY) && Math.abs(x) < 0.2, 'landmark off the face');
    }
  });
}

function checkRegions(name, regions) {
  const image = loadImages(models[name])[0], body = tris[name].filter(t => t.material === 0);
  const center = t => [0, 1, 2].map(k => (t.bind[0][k] + t.bind[1][k] + t.bind[2][k]) / 3);
  const at = t => sample(image, [0, 1].map(k => (t.uv[0][k] + t.uv[1][k] + t.uv[2][k]) / 3));
  const kinds = {
    skin: ([r, g, b]) => r > g && g > b && r - b > 50,
    purple: ([r, g, b]) => r > g + 10 && b > g + 15,
    ivory: ([r, g, b]) => r > 130 && g > 120 && r >= g && g > b,
    dark: c => Math.max(...c) < 80,
  };
  for (const [label, kind, where] of regions) {
    const found = body.filter(t => where(center(t), faceNormal(t.bind)));
    assert.ok(found.length >= 2, `no triangles found for ${label}`);
    const good = found.filter(t => kinds[kind](at(t))).length;
    assert.ok(good / found.length >= 0.9, `${label}: only ${good}/${found.length} triangles look ${kind}`);
  }
}

test('jacket: body parts carry the right kind of color', () => {
  const regions = [
    ['hands', 'skin', p => Math.abs(p[0]) > 1.95],
    ['legs', 'dark', p => p[1] > 0.6 && p[1] < 2.6],
    ['feet', 'dark', p => p[1] < 0.3],
    ['back of head', 'purple', (p, n) => p[1] > 5.35 && n[2] < -0.5],
  ];
  checkRegions('jacket', regions);
});

test('jacket: the leather is black with bright glints, over a black tee', () => {
  const r = render(models.jacket, { triangles: tris.jacket, size: 900 }), bright = c => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const jacket = t => t.material === 0 && t.bind.every(p => p[1] > 3.3 && p[1] < 4.8 && Math.abs(p[0]) < 1.7);
  const levels = r.hit.flatMap((t, i) => (t && jacket(t) ? [bright(r.data.subarray(i * 4, i * 4 + 3))] : []));
  const share = test => levels.filter(test).length / levels.length;
  assert.ok(levels.length > 5000);
  assert.ok(share(v => v < 70) > 0.75, 'mostly black');
  assert.ok(share(v => v > 90) > 0.04 && share(v => v > 90) < 0.25, `glossy scales: ${share(v => v > 90)}`);
});

test('jacket: the collar stands around the neck without covering the face', () => {
  const { gltf } = models.jacket, collar = gltf.materials.findIndex(m => m.name === 'Jacket_Collar'), face = gltf.materials.findIndex(m => m.name === 'Face_Photo');
  for (const yaw of [0, 45, -45]) {
    const r = render(models.jacket, { triangles: tris.jacket, size: 900, yaw }), without = render(models.jacket, { triangles: tris.jacket.filter(t => t.material !== collar), size: 900, yaw, box: boxOf(tris.jacket) });
    const count = (image, m) => image.hit.filter(t => t && t.material === m).length;
    assert.ok(count(r, collar) > 150, 'collar should be visible');
    assert.ok(count(r, face) > count(without, face) * 0.97, 'collar hides the face');
  }
});

function boxOf(triangles) {
  const p = triangles.flatMap(t => t.world);
  const lo = [0, 1, 2].map(k => Math.min(...p.map(v => v[k]))), hi = [0, 1, 2].map(k => Math.max(...p.map(v => v[k])));
  return { center: lo.map((v, k) => (v + hi[k]) / 2), size: Math.max(...hi.map((v, k) => v - lo[k])) * 1.08 };
}

test('kurta_salwar: body parts carry the right kind of color', () => {
  checkRegions('kurta_salwar', [
    ['hands', 'skin', p => Math.abs(p[0]) > 1.95],
    ['legs', 'ivory', p => p[1] > 0.6 && p[1] < 2.6],
    ['back of head', 'dark', (p, n) => p[1] > 5.35 && n[2] < -0.5],
  ]);
});

// Area share rather than triangle centers, since the print puts gold on some centers.
test('kurta_salwar: torso and skirt are mostly teal and the hem has a border', () => {
  const skirtImage = loadImages(models.kurta_salwar)[2];
  const r = render(models.kurta_salwar, { triangles: tris.kurta_salwar, size: 800 });
  const teal = ([x, g, b]) => g > x + 30 && b > x + 30;
  const share = where => {
    const pixels = r.hit.flatMap((t, i) => (t && where(t) ? [Array.from(r.data.subarray(i * 4, i * 4 + 3))] : []));
    assert.ok(pixels.length > 2000, 'region must be visible from the front');
    return pixels.filter(teal).length / pixels.length;
  };
  const torso = t => t.material === 0 && t.bind.every(p => p[1] > 3.7 && p[1] < 4.87 && Math.abs(p[0]) < 0.75);
  assert.ok(share(t => t.material === 2) > 0.6, 'skirt should be mostly teal');
  assert.ok(share(torso) > 0.5, 'torso should be mostly teal');
  for (const u of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) assert.ok(!teal(sample(skirtImage, [u, 0.95])), 'hem border missing');
});

test('kurta_salwar: skirt covers the thighs in the rest pose', () => {
  const thigh = t => t.material === 0 && t.bind.every(p => p[1] > 2.3 && p[1] < 3.3 && Math.abs(p[0]) < 0.6);
  for (const yaw of [0, 180]) {
    const r = render(models.kurta_salwar, { triangles: tris.kurta_salwar, size: 800, yaw });
    const poking = r.hit.filter(t => t && thigh(t)).length, skirt = r.hit.filter(t => t && t.material === 2).length;
    assert.ok(poking / skirt < 0.02, `${poking} thigh pixels show through ${skirt} skirt pixels at yaw ${yaw}`);
  }
});

test('kurta_salwar: clothing skin weights are normalized', () => {
  const { gltf, bin } = models.kurta_salwar, p = gltf.meshes[0].primitives[2];
  for (const w of readAccessor(gltf, bin, p.attributes.WEIGHTS_0)) {
    assert.ok(Math.abs(w.reduce((s, v) => s + v, 0) - 1) < 1e-5);
  }
});

test('exported profile matches the code', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(assets, 'ps1_face_profile.json'), 'utf8'));
  const { outlineUv, ...rest } = saved;
  assert.deepEqual(rest, exportProfile());
  const inside = ([x, y]) => outlineUv.reduce((odd, [x1, y1], i) => {
    const [x2, y2] = outlineUv[(i + 1) % outlineUv.length];
    return (y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1 ? !odd : odd;
  }, false);
  for (const [name, p] of Object.entries(saved.landmarksUv)) assert.ok(inside(p), `${name} is outside the face outline`);
});

test('skin masks and hair overlays match the textures they describe', () => {
  for (const outfit of OUTFITS) {
    const load = f => decodePng(fs.readFileSync(path.join(assets, f)));
    const mask = load(outfit.files.skinMask), body = load(outfit.files.body);
    const hair = load(outfit.files.hair), face = load(outfit.files.face);
    let skin = 0;
    for (let i = 0; i < mask.data.length; i += 4) {
      if (mask.data[i] < 128) continue;
      skin += 1;
      assert.ok(body.data[i] > body.data[i + 1] && body.data[i + 1] > body.data[i + 2], 'mask marks a non-skin texel');
    }
    assert.ok(skin > 1500, 'expected a useful amount of skin');
    let opaque = 0;
    for (let i = 0; i < hair.data.length; i += 4) {
      if (!hair.data[i + 3]) continue;
      opaque += 1;
      assert.deepEqual([...hair.data.subarray(i, i + 3)], [...face.data.subarray(i, i + 3)]);
    }
    assert.ok(opaque > 1000 && opaque < hair.data.length / 4 * 0.6, `hair covers ${opaque} texels`);
  }
});

test('side profile matches the code and the panel lies inside its texture', () => {
  const { outlineUv, ...rest } = JSON.parse(fs.readFileSync(path.join(assets, 'ps1_side_profile.json'), 'utf8'));
  assert.deepEqual(rest, exportSideProfile());
  assert.ok(outlineUv.length >= 6 && outlineUv.flat().every(v => v >= 0 && v <= 1));
});

for (const name of Object.keys(files)) {
  for (const [side, yaw] of [['Left', -90], ['Right', 90]]) {
    test(`${name}: a side image appears upright and unmirrored on the viewer's ${side.toLowerCase()}`, () => {
      const model = models[name], material = model.gltf.materials.findIndex(m => m.name === `Side_Viewer${side}`);
      const index = model.gltf.materials[material].pbrMetallicRoughness.baseColorTexture.index, images = loadImages(model);
      images[model.gltf.textures[index].source] = quadrantImage(64);
      const r = render(model, { triangles: tris[name], images, size: 900, yaw });
      const seen = {};
      r.hit.forEach((t, i) => {
        if (!t || t.material !== material) return;
        const color = Array.from(r.data.subarray(i * 4, i * 4 + 3)), key = Object.keys(QUADRANTS).find(k => distance(QUADRANTS[k], color) < 5);
        const s = seen[key] ||= [0, 0, 0];
        s[0] += i % r.width; s[1] += Math.floor(i / r.width); s[2] += 1;
      });
      const c = Object.fromEntries(Object.entries(seen).map(([k, [x, y, n]]) => [k, [x / n, y / n]]));
      assert.ok(c.tl[0] < c.tr[0] && c.bl[0] < c.br[0], 'image left must be on the viewer left');
      assert.ok(c.tl[1] < c.bl[1] && c.tr[1] < c.br[1], 'image top must be at the top');
    });
  }

  test(`${name}: side and face textures meet along the same rows`, () => {
    const named = n => models[name].gltf.materials.findIndex(m => m.name === n);
    const row = new Map(tris[name].filter(t => t.material === named('Face_Photo')).flatMap(t => t.bind.map((p, i) => [p.map(v => v.toFixed(4)).join(), t.uv[i][1]])));
    let shared = 0;
    for (const t of tris[name].filter(t => [named('Side_ViewerLeft'), named('Side_ViewerRight')].includes(t.material))) {
      t.bind.forEach((p, i) => {
        const v = row.get(p.map(c => c.toFixed(4)).join());
        if (v === undefined) return;
        shared += 1;
        assert.ok(Math.abs(v - t.uv[i][1]) < 1e-5);
      });
    }
    assert.ok(shared >= 8, 'the panels should share an edge');
  });
}

test('face depth map covers the whole face and is symmetric', () => {
  const depth = decodePng(fs.readFileSync(path.join(assets, 'ps1_face_depth.png')));
  const at = (x, y) => depth.data[(y * 128 + x) * 4];
  const { outlineUv } = JSON.parse(fs.readFileSync(path.join(assets, 'ps1_face_profile.json'), 'utf8'));
  for (const [u, v] of outlineUv) assert.ok(at(Math.floor(u * 127.9), Math.floor(v * 127.9)) > 60, `empty depth at the edge ${u},${v}`);
  for (const [u, v] of Object.values(FACE_PROFILE.landmarks).map(p => faceUv(p))) assert.ok(at(Math.floor(u * 127), Math.floor(v * 127)) > 150);
  for (const [x, y] of [[20, 60], [35, 80], [50, 40]]) assert.ok(Math.abs(at(x, y) - at(127 - x, y)) <= 2);
  assert.ok(at(64, 80) > at(20, 80), 'the nose is further forward than the cheek');
});

test('png: round-trips', () => {
  const image = quadrantImage(8);
  assert.deepEqual(decodePng(encodePng(image)), image);
});
