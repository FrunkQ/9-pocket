import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on your local network so a phone's
// browser will allow camera access (it refuses on plain http).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: { port: 5173 },
}));
