// Static server for the viewer. Run with: npm run viewer, then open http://localhost:5178
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..'), port = Number(process.env.PORT) || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const served = ['assets', 'tools/viewer', 'node_modules/three'].map(d => path.join(root, d) + path.sep);

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, pathname === '/' ? 'tools/viewer/index.html' : pathname);
  if (!served.some(d => file.startsWith(d)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Viewer at http://localhost:${port}`));
