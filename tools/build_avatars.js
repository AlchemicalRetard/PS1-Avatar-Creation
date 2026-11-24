// Build one GLB per outfit from the rigged PS1 base: bake the body atlas, split the face into its own
// photo-ready material, and attach any extra clothing pieces. Keeps the source rig and animation.
// Run with: node tools/build_avatars.js
const fs = require('node:fs');
const path = require('node:path');
const { readAccessor, repack, writeGlb } = require('./lib/gltf');
const { eachPixel, mix, faceNormal } = require('./lib/raster');
const { encodePng } = require('./lib/png');
const { FACE_PROFILE, faceUv, exportProfile, SIDE_PROFILE, sideUv, exportSideProfile } = require('./lib/face_profile');

const OUTFITS = [require('./outfits/jacket'), require('./outfits/kurta_salwar')];
const BODY_SIZE = 256;
const PADDING = 4; // texels bled outside each UV island so edges never sample background

// Forward-facing head triangles from the chin up; the underside of the jaw stays on the body atlas.
function isFaceTriangle(points) {
  return points.every(p => p[1] > 5.14 && Math.abs(p[0]) < 0.3) && faceNormal(points)[2] > 0.3;
}

// Outward-facing sides of the head; the back, top and underside of the jaw stay on the body atlas.
// Returns 'left' or 'right' as seen by someone facing the avatar, or null.
function sideOf(points) {
  if (!points.every(p => p[1] > 5.14 && Math.abs(p[0]) < 0.3)) return null;
  const nx = faceNormal(points)[0];
  return nx < -0.8 ? 'left' : nx > 0.8 ? 'right' : null;
}

/** Side texture coordinates; the right side is seen from the other direction, so it is mirrored. */
function sideTexCoord([, y, z], side) {
  const [u, v] = sideUv([z, y]);
  return [side === 'left' ? u : 1 - u, v];
}

// Copies edge colors outward so sampling at an island's edge never picks up background.
function bleed(data, filled, size) {
  let covered = filled;
  for (let pass = 0; pass < PADDING; pass++) {
    const next = covered.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (covered[y * size + x]) continue;
        const from = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
          .find(([a, b]) => a >= 0 && b >= 0 && a < size && b < size && covered[b * size + a]);
        if (!from) continue;
        const at = (from[1] * size + from[0]) * 4;
        data.copyWithin((y * size + x) * 4, at, at + 4);
        next[y * size + x] = 1;
      }
    }
    covered = next;
  }
  return covered;
}

// For each texel of the face texture, the column of the (canonical) side texture at the same spot.
function bakeFaceDepth(faceIds, face) {
  const size = FACE_PROFILE.textureSize, data = new Uint8Array(size * size * 4), covered = new Uint8Array(size * size);
  for (let i = 0; i < faceIds.length; i += 3) {
    const t = faceIds.slice(i, i + 3), u = t.map(k => [sideUv([face.POSITION[k][2], face.POSITION[k][1]])[0]]);
    eachPixel(t.map(k => face.TEXCOORD_0[k].map(v => v * size)), size, size, (x, y, w0, w1, w2) => {
      const value = Math.round(mix(u, w0, w1, w2)[0] * 255);
      data.set([value, value, value, 255], (y * size + x) * 4);
      covered[y * size + x] = 1;
    });
  }
  bleed(data, covered, size);
  return { width: size, height: size, data };
}

// The panel's silhouette as a closed UV polygon: the edges used by exactly one triangle, chained.
function outlineUv(faceIds, uvs) {
  const edges = new Map();
  for (let i = 0; i < faceIds.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = faceIds[i + k], b = faceIds[i + (k + 1) % 3];
      if (!edges.delete(`${b},${a}`)) edges.set(`${a},${b}`, [a, b]);
    }
  }
  const next = new Map(edges.values()), start = next.keys().next().value, loop = [];
  for (let v = start; loop.length < next.size; v = next.get(v)) loop.push(v);
  return loop.map(v => uvs[v].map(c => Number(c.toFixed(4))));
}

// Paints each triangle's texels with color(position, normal), then pads around the islands.
function bakeAtlas(size, triangles, positions, uvs, color, shaded = true) {
  const data = new Uint8Array(size * size * 4);
  let covered = new Uint8Array(size * size);
  for (const t of triangles) {
    const points = t.map(i => positions[i]), normal = faceNormal(points);
    const shade = shaded ? 1 + Math.max(-0.14, Math.min(0.08, normal[2] * 0.08)) : 1;
    eachPixel(t.map(i => uvs[i].map(v => v * size)), size, size, (x, y, w0, w1, w2) => {
      const rgb = color(mix(points, w0, w1, w2), normal).map(c => Math.min(255, Math.round(c * shade)));
      data.set([...rgb, 255], (y * size + x) * 4);
      covered[y * size + x] = 1;
    });
  }
  covered = bleed(data, covered, size);
  for (let i = 0; i < size * size; i++) if (!covered[i]) data.set([38, 34, 46, 255], i * 4);
  return { width: size, height: size, data };
}

// With `keep`, only those palette entries stay opaque.
function bakeFace(faceColor, keep) {
  const size = FACE_PROFILE.textureSize, b = FACE_PROFILE.bounds, data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = b.xMin + (px + 0.5) / size * (b.xMax - b.xMin), y = b.yMax - (py + 0.5) / size * (b.yMax - b.yMin);
      const color = faceColor(x, y);
      data.set([...color, keep && !keep.includes(color) ? 0 : 255], (py * size + px) * 4);
    }
  }
  return { width: size, height: size, data };
}

const bounds = rows => ({
  min: [0, 1, 2].map(k => Math.min(...rows.map(r => Math.fround(r[k])))),
  max: [0, 1, 2].map(k => Math.max(...rows.map(r => Math.fround(r[k])))),
});

function smoothNormals(positions, triangles) {
  const sums = new Map(), key = p => p.map(v => v.toFixed(4)).join();
  for (const t of triangles) {
    const points = t.map(i => positions[i]), n = faceNormal(points);
    for (const p of points) sums.set(key(p), (sums.get(key(p)) || [0, 0, 0]).map((v, k) => v + n[k]));
  }
  return positions.map(p => {
    const n = sums.get(key(p)), length = Math.hypot(...n);
    return n.map(v => v / length);
  });
}

function pieceAttributes(piece, gltf) {
  const jointIndex = name => {
    const i = gltf.skins[0].joints.findIndex(j => gltf.nodes[j].name === name);
    if (i < 0) throw new Error(`Unknown joint ${name}`);
    return i;
  };
  const positions = piece.vertices.map(v => v.position);
  const influences = piece.vertices.map(v => {
    const used = v.weights.filter(([, w]) => w > 1e-4), total = used.reduce((sum, [, w]) => sum + w, 0);
    return [0, 1, 2, 3].map(k => (used[k] ? [jointIndex(used[k][0]), used[k][1] / total] : [0, 0]));
  });
  return {
    POSITION: positions,
    NORMAL: smoothNormals(positions, piece.triangles),
    TEXCOORD_0: piece.vertices.map(v => v.uv),
    JOINTS_0: influences.map(row => row.map(([j]) => j)),
    WEIGHTS_0: influences.map(row => row.map(([, w]) => w)),
  };
}

function buildOutfit(outfit, sourceDir, outDir) {
  const gltf = JSON.parse(fs.readFileSync(path.join(sourceDir, 'scene.gltf'), 'utf8'));
  const bin = fs.readFileSync(path.join(sourceDir, 'scene.bin'));
  const body = gltf.meshes[0].primitives[0], pieces = outfit.pieces || [];
  const attributes = Object.fromEntries(Object.entries(body.attributes).map(([k, i]) => [k, readAccessor(gltf, bin, i)]));
  // The source names joints in unused influence slots; glTF wants those to be 0.
  attributes.JOINTS_0 = attributes.JOINTS_0.map((row, i) => row.map((j, k) => (attributes.WEIGHTS_0[i][k] ? j : 0)));
  gltf.accessors[body.attributes.JOINTS_0].rows = attributes.JOINTS_0;

  const positions = attributes.POSITION, ids = readAccessor(gltf, bin, body.indices).flat();
  const bodyTriangles = [], faceTriangles = [], sideTriangles = { left: [], right: [] };
  for (let i = 0; i < ids.length; i += 3) {
    const t = ids.slice(i, i + 3);
    const points = t.map(k => positions[k]);
    (isFaceTriangle(points) ? faceTriangles : sideTriangles[sideOf(points)] || bodyTriangles).push(t);
  }

  // Compact a panel's vertices under new UVs: old UV seams split them, so weld those that now match.
  const panel = (triangles, texCoord) => {
    const welded = new Map(), rows = Object.fromEntries(Object.keys(attributes).map(k => [k, []])), panelIds = [];
    for (const i of triangles.flat()) {
      const key = JSON.stringify(Object.entries(attributes).filter(([k]) => k !== 'TEXCOORD_0').map(([, values]) => values[i]));
      if (!welded.has(key)) {
        welded.set(key, rows.POSITION.length);
        for (const k of Object.keys(attributes)) rows[k].push(k === 'TEXCOORD_0' ? texCoord(positions[i]) : attributes[k][i]);
      }
      panelIds.push(welded.get(key));
    }
    return { rows, ids: panelIds };
  };
  const { rows: face, ids: faceIds } = panel(faceTriangles, faceUv);
  const sides = ['left', 'right'].map(side => ({ side, ...panel(sideTriangles[side], p => sideTexCoord(p, side)) }));

  const addAccessor = (like, rows, withBounds) => {
    const { type, componentType } = gltf.accessors[like];
    return gltf.accessors.push({ type, componentType, rows, ...(withBounds ? bounds(rows) : {}) }) - 1;
  };
  const addPrimitive = (rows, indices, material) => gltf.meshes[0].primitives.push({
    attributes: Object.fromEntries(Object.entries(body.attributes).map(([k, i]) => [k, addAccessor(i, rows[k], k === 'POSITION')])),
    indices: addAccessor(body.indices, indices.map(i => [i])),
    material,
    mode: 4,
  });
  addPrimitive(face, faceIds, 1);
  const extra = pieces.map(piece => pieceAttributes(piece, gltf));
  pieces.forEach((piece, i) => addPrimitive(extra[i], piece.triangles.flat(), 2 + i));
  sides.forEach(({ rows, ids: sideIds }, i) => addPrimitive(rows, sideIds, 2 + pieces.length + i));

  gltf.accessors[body.indices].rows = bodyTriangles.flat().map(i => [i]);
  delete gltf.accessors[body.indices].min;
  delete gltf.accessors[body.indices].max;
  if (outfit.deform) {
    const rows = positions.map(outfit.deform);
    Object.assign(gltf.accessors[body.attributes.POSITION], { rows }, bounds(rows));
  }

  const names = ['Body', 'Face_Photo', ...pieces.map(p => p.name), 'Side_ViewerLeft', 'Side_ViewerRight'];
  gltf.materials = names.map((name, i) => ({
    name,
    doubleSided: true,
    pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: 1 },
  }));
  body.material = 0;
  gltf.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
  gltf.textures = names.map((_, i) => ({ sampler: 0, source: i }));
  delete gltf.extensionsUsed; // only used by the replaced source material
  gltf.asset.copyright = 'Based on "Base for a ps1 style character" by MR_Fisher '
    + '(https://sketchfab.com/3d-models/base-for-a-ps1-style-character-b00cffd4773f4b8f8aed8c18a47ff54a), '
    + 'CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Modified: textured, face re-UVed'
    + `${outfit.deform || pieces.length ? ', clothing geometry changed' : ''}.`;

  const chunk3 = list => Array.from({ length: list.length / 3 }, (_, i) => list.slice(i * 3, i * 3 + 3));
  const bakeSide = (s, color, shaded) => bakeAtlas(SIDE_PROFILE.textureSize, chunk3(s.ids), s.rows.POSITION, s.rows.TEXCOORD_0, color, shaded);
  const images = [
    bakeAtlas(BODY_SIZE, bodyTriangles, positions, attributes.TEXCOORD_0, outfit.bodyColor),
    bakeFace(outfit.faceColor),
    ...pieces.map((p, i) => bakeAtlas(p.textureSize, p.triangles, extra[i].POSITION, extra[i].TEXCOORD_0, p.color)),
    ...sides.map(s => bakeSide(s, outfit.bodyColor)),
  ].map((image, i) => ({ name: names[i], png: encodePng(image) }));
  const targets = [outfit.files.body, outfit.files.face, ...pieces.map(p => outfit.files[p.name]), outfit.files.sideLeft, outfit.files.sideRight];
  images.forEach(({ png }, i) => fs.writeFileSync(path.join(outDir, targets[i]), png));
  const packed = repack(gltf, bin, images);
  writeGlb(path.join(outDir, outfit.files.glb), packed.gltf, packed.bin);
  // Extras for the photo app: masks of skin (red) and hair (green), and the hair to keep above a pasted photo.
  const regions = (p, n) => {
    const color = outfit.bodyColor(p, n);
    return [outfit.skinColors.includes(color) ? 255 : 0, outfit.hairColors.includes(color) ? 255 : 0, 0];
  };
  const save = (file, image) => fs.writeFileSync(path.join(outDir, file), encodePng(image));
  save(outfit.files.skinMask, bakeAtlas(BODY_SIZE, bodyTriangles, positions, attributes.TEXCOORD_0, regions, false));
  save(outfit.files.sideMaskLeft, bakeSide(sides[0], regions, false));
  save(outfit.files.sideMaskRight, bakeSide(sides[1], regions, false));
  save('ps1_face_depth.png', bakeFaceDepth(faceIds, face));
  fs.writeFileSync(path.join(outDir, outfit.files.hair), encodePng(bakeFace(outfit.faceColor, outfit.hairColors)));
  const extraCount = pieces.reduce((n, p) => n + p.triangles.length, 0);
  console.log(`Wrote ${outfit.files.glb} (${bodyTriangles.length} body + ${faceTriangles.length} face + ${sideTriangles.left.length * 2} side + ${extraCount} clothing triangles)`);
  return { face: outlineUv(faceIds, face.TEXCOORD_0), side: outlineUv(sides[0].ids, sides[0].rows.TEXCOORD_0) };
}

function build() {
  const outDir = path.resolve(__dirname, '../assets');
  const writeJson = (file, value) => fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(value, null, 2)}\n`);
  const outlines = OUTFITS.map(outfit => buildOutfit(outfit, path.join(outDir, 'reference_base_ps1'), outDir));
  writeJson('ps1_face_profile.json', { ...exportProfile(), outlineUv: outlines[0].face });
  writeJson('ps1_side_profile.json', { ...exportSideProfile(), outlineUv: outlines[0].side });
  writeJson('ps1_outfits.json', OUTFITS.map(({ id, label, files, baseSkin, baseHair }) => ({ id, label, files, baseSkin, baseHair })));
}

if (require.main === module) build();
module.exports = { OUTFITS, build };
