import fs from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

// Online voices need the server-side key; see .env.example. It is never bundled into the page.
const env = new URL('../.env', import.meta.url);
if (fs.existsSync(env)) process.loadEnvFile(env);
const { createSpeechProxy } = createRequire(import.meta.url)('../tools/lib/speech_proxy.js');

export default defineConfig({
  base: './', // every path is relative, so the build works in any folder of any host
  publicDir: '../assets', // avatars, textures and the face profile
  server: { port: 5179, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  plugins: [{
    name: 'speech-proxy',
    configureServer(server) {
      const speech = createSpeechProxy({ key: process.env.SPEECHMA_API_KEY });
      server.middlewares.use((req, res, next) => {
        speech(req, res).then((handled: boolean) => handled || next(), next);
      });
    },
  }],
});
