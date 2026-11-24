// Software rasterizer used both to bake textures and to render check images.
const { decodePng } = require('./png');
const { worldTriangles } = require('./gltf');

// Calls visit(x, y, w0, w1, w2) for every pixel whose center lies in the 2D triangle.
function eachPixel([a, b, c], width, height, visit) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return;
  const range = (k, limit) => [
    Math.max(0, Math.floor(Math.min(a[k], b[k], c[k]))),
    Math.min(limit - 1, Math.ceil(Math.max(a[k], b[k], c[k])))];
  const [x0, x1] = range(0, width), [y0, y1] = range(1, height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
      const w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) visit(x, y, w0, w1, w2);
    }
  }
}

const mix = (values, w0, w1, w2) => values[0].map((v, k) => v * w0 + values[1][k] * w1 + values[2][k] * w2);

function faceNormal([a, b, c]) {
  const u = b.map((v, k) => v - a[k]), w = c.map((v, k) => v - a[k]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const length = Math.hypot(...n) || 1;
  return n.map(v => v / length);
}

// glTF convention: uv (0,0) is the top-left of the image. Nearest sampling, clamped.
function sample(image, [u, v]) {
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(u * image.width)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(v * image.height)));
  return Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
}

function loadImages({ gltf, bin }) {
  return (gltf.images || []).map(image => {
    const view = gltf.bufferViews[image.bufferView];
    return decodePng(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  });
}

// Returns {width,height,data,hit,project}; hit[i] is the triangle drawn at pixel i (or undefined).
// yaw is the angle in degrees the camera circles around: 0 is the front (+Z), 90 is the +X side.
function render(model, { yaw = 0, size = 480, box, images = loadImages(model), triangles = worldTriangles(model) } = {}) {
  const a = yaw * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const view = ([x, y, z]) => [x * cos - z * sin, y, x * sin + z * cos];
  if (!box) {
    const all = triangles.flatMap(t => t.world);
    const lo = [0, 1, 2].map(k => Math.min(...all.map(p => p[k])));
    const hi = [0, 1, 2].map(k => Math.max(...all.map(p => p[k])));
    box = { center: lo.map((v, k) => (v + hi[k]) / 2), size: Math.max(...hi.map((v, k) => v - lo[k])) * 1.08 };
  }
  const center = view(box.center), scale = size / box.size;
  const project = p => {
    const v = view(p);
    return [size / 2 + (v[0] - center[0]) * scale, size / 2 - (v[1] - center[1]) * scale, v[2]];
  };
  const data = new Uint8Array(size * size * 4).fill(205);
  const depth = new Float32Array(size * size).fill(-Infinity), hit = new Array(size * size);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const t of triangles) {
    const q = t.world.map(project), pbr = model.gltf.materials[t.material].pbrMetallicRoughness;
    const texture = pbr.baseColorTexture && images[model.gltf.textures[pbr.baseColorTexture.index].source];
    const flat = (pbr.baseColorFactor || [1, 1, 1]).slice(0, 3).map(c => Math.round(255 * c ** (1 / 2.2)));
    const light = texture ? 1 : 0.85 + 0.15 * Math.abs(faceNormal(q)[2]);
    eachPixel(q, size, size, (x, y, w0, w1, w2) => {
      const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], i = y * size + x;
      if (z <= depth[i]) return;
      depth[i] = z;
      hit[i] = t;
      const color = texture ? sample(texture, mix(t.uv, w0, w1, w2)) : flat;
      for (let k = 0; k < 3; k++) data[i * 4 + k] = color[k] * light;
    });
  }
  return { width: size, height: size, data, hit, project };
}

function sheet(renders) {
  const { width: w, height: h } = renders[0], data = new Uint8Array(w * renders.length * h * 4);
  renders.forEach((r, n) => {
    for (let y = 0; y < h; y++) data.set(r.data.subarray(y * w * 4, (y + 1) * w * 4), (y * w * renders.length + n * w) * 4);
  });
  return { width: w * renders.length, height: h, data };
}

module.exports = { eachPixel, mix, faceNormal, sample, loadImages, render, sheet };
