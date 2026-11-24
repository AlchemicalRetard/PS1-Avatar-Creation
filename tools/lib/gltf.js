// Small glTF 2.0 helpers: read accessors, repack buffers, read/write GLB, and pose meshes.
const fs = require('node:fs');

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = {
  5121: [1, 'readUInt8', 'writeUInt8'],
  5123: [2, 'readUInt16LE', 'writeUInt16LE'],
  5125: [4, 'readUInt32LE', 'writeUInt32LE'],
  5126: [4, 'readFloatLE', 'writeFloatLE'],
};

function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type], [size, read] = TYPES[a.componentType];
  const stride = view.byteStride || n * size, start = (view.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: n }, (_, k) => bin[read](start + i * stride + k * size)));
}

function packRows(rows, componentType) {
  const [size, , write] = TYPES[componentType], flat = rows.flat(), out = Buffer.alloc(flat.length * size);
  flat.forEach((v, i) => out[write](v, i * size));
  return out;
}

// Rebuilds one tight buffer. Accessors with a `rows` property use that data instead of the source.
function repack(gltf, sourceBin, imagePngs) {
  const parts = [], views = [];
  let length = 0;
  const add = (data, target) => {
    const pad = (4 - length % 4) % 4;
    parts.push(Buffer.alloc(pad), data);
    length += pad;
    views.push({ buffer: 0, byteOffset: length, byteLength: data.length, ...(target ? { target } : {}) });
    length += data.length;
    return views.length - 1;
  };
  const targets = new Map();
  for (const mesh of gltf.meshes) {
    for (const p of mesh.primitives) {
      for (const a of Object.values(p.attributes)) targets.set(a, 34962);
      targets.set(p.indices, 34963);
    }
  }
  const accessors = gltf.accessors.map((a, i) => {
    const { rows = readAccessor(gltf, sourceBin, i), byteOffset, ...rest } = a;
    return { ...rest, count: rows.length, bufferView: add(packRows(rows, a.componentType), targets.get(i)) };
  });
  const images = imagePngs.map(({ name, png }) => ({ name, mimeType: 'image/png', bufferView: add(png) }));
  const bin = Buffer.concat(parts);
  return { gltf: { ...gltf, accessors, images, bufferViews: views, buffers: [{ byteLength: bin.length }] }, bin };
}

function writeGlb(file, gltf, bin) {
  const section = (data, type, fill) => {
    const body = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4, fill)]), head = Buffer.alloc(8);
    head.writeUInt32LE(body.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, body]);
  };
  const json = section(Buffer.from(JSON.stringify(gltf)), 0x4e4f534a, 0x20), binary = section(bin, 0x004e4942, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + json.length + binary.length, 8);
  fs.writeFileSync(file, Buffer.concat([header, json, binary]));
}

function readGlb(file) {
  const bytes = fs.readFileSync(file), jsonLength = bytes.readUInt32LE(12);
  return { gltf: JSON.parse(bytes.subarray(20, 20 + jsonLength)), bin: bytes.subarray(28 + jsonLength) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1], t = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    ...t, 1];
}

const transform = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);

// Every triangle in world space as a viewer shows it at rest: node transforms plus skinning.
// `bind` keeps the untransformed positions, which are convenient for anatomical queries.
function worldTriangles({ gltf, bin }) {
  const world = [], out = [];
  const walk = (i, parent) => {
    world[i] = multiply(parent, localMatrix(gltf.nodes[i]));
    (gltf.nodes[i].children || []).forEach(c => walk(c, world[i]));
  };
  gltf.scenes[gltf.scene || 0].nodes.forEach(i => walk(i, IDENTITY));
  gltf.nodes.forEach((node, ni) => {
    if (node.mesh === undefined) return;
    const skin = node.skin === undefined ? null : gltf.skins[node.skin];
    const inverse = skin && readAccessor(gltf, bin, skin.inverseBindMatrices);
    const joints = skin && skin.joints.map((j, k) => multiply(world[j], inverse[k]));
    for (const p of gltf.meshes[node.mesh].primitives) {
      const get = name => (p.attributes[name] === undefined ? null : readAccessor(gltf, bin, p.attributes[name]));
      const bind = get('POSITION'), uv = get('TEXCOORD_0'), J = get('JOINTS_0'), W = get('WEIGHTS_0');
      const posed = bind.map((v, i) => {
        if (!skin) return transform(world[ni], v);
        const sum = [0, 0, 0];
        J[i].forEach((j, k) => {
          if (W[i][k]) transform(joints[j], v).forEach((c, r) => { sum[r] += c * W[i][k]; });
        });
        return sum;
      });
      const ids = readAccessor(gltf, bin, p.indices).flat();
      for (let i = 0; i < ids.length; i += 3) {
        const t = ids.slice(i, i + 3);
        out.push({
          mesh: gltf.meshes[node.mesh].name,
          material: p.material,
          bind: t.map(k => bind[k]),
          world: t.map(k => posed[k]),
          uv: uv && t.map(k => uv[k]),
        });
      }
    }
  });
  return out;
}

module.exports = { readAccessor, repack, writeGlb, readGlb, worldTriangles };
