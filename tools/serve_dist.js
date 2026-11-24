// Serves only the production build in dist/, for testing on other devices through an HTTPS tunnel.
// Run with: npm run build:app && npm run serve
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createSpeechProxy } = require('./lib/speech_proxy');

const root = path.resolve(__dirname, '../dist'), port = Number(process.env.PORT) || 5180;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.glb': 'model/gltf-binary',
};

const speech = createSpeechProxy({ key: process.env.SPEECHMA_API_KEY });

http.createServer(async (req, res) => {
  if (await speech(req, res)) return;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    pathname = '\0';
  }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`), type = types[path.extname(file)];
  const allowed = ['GET', 'HEAD'].includes(req.method) && type && !pathname.includes('\0') && file.startsWith(root + path.sep);
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Serving dist at http://localhost:${port}`));
