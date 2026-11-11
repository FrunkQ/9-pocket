import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Files in public/ that the app needs to open offline. (The hockey
// catalogue is not here: it is large, and is stored set by set as used.)
const STATIC = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

/**
 * Writes sw.js into the build with the list of built files baked in, so the
 * service worker can store the whole app on install. The version is a hash of
 * that list; file names carry content hashes, so any change gives a new one.
 */
function serviceWorker(): Plugin {
  return {
    name: 'nine-pocket-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const files = [...new Set(['./', 'index.html', ...STATIC, ...built])];
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 10);
      const source = readFileSync('sw/sw.js', 'utf8').replace("'__VERSION__'", `'${version}'`).replace("'__FILES__'", JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// `npm run dev:phone` serves over HTTPS on your local network so a phone's
// browser will allow camera access (it refuses on plain http).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), serviceWorker(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: { port: 5173 },
}));
