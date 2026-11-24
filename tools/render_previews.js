// Render front / three-quarter / side / back contact sheets into .preview/ for a quick look.
// Run with: node tools/render_previews.js
const fs = require('node:fs');
const path = require('node:path');
const { readGlb, worldTriangles } = require('./lib/gltf');
const { render, sheet } = require('./lib/raster');
const { writePng } = require('./lib/png');
const { OUTFITS } = require('./build_avatars');

const root = path.resolve(__dirname, '..'), out = path.join(root, '.preview');
fs.mkdirSync(out, { recursive: true });
for (const name of OUTFITS.map(o => path.parse(o.files.glb).name)) {
  const model = readGlb(path.join(root, 'assets', `${name}.glb`)), triangles = worldTriangles(model);
  const views = [0, 45, 90, 180];
  writePng(path.join(out, `${name}.png`), sheet(views.map(yaw => render(model, { yaw, triangles }))));
  const points = triangles.flatMap(t => t.world), top = Math.max(...points.map(p => p[1]));
  const height = top - Math.min(...points.map(p => p[1]));
  const head = points.filter(p => p[1] > top - height * 0.12);
  const mid = k => (Math.min(...head.map(p => p[k])) + Math.max(...head.map(p => p[k]))) / 2;
  const box = { center: [mid(0), top - height * 0.075, mid(2)], size: height * 0.2 };
  writePng(path.join(out, `${name}_head.png`), sheet(views.map(yaw => render(model, { yaw, triangles, box }))));
}
console.log(`Wrote previews to ${out}`);
