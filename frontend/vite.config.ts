import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// `docker compose` sets VITE_API_TARGET=http://api:8000 for the web container.
const target = process.env.VITE_API_TARGET ?? 'http://localhost:8000'

// /dev and /client are both SPA pages and API prefixes: browser navigations
// (Accept: text/html) must get the SPA, fetch() calls go to the backend.
const proxied = {
  target,
  bypass: (req: { headers: { accept?: string } }) =>
    req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
}

const proxy = {
  '/setup': proxied,
  '/sim': proxied,
  '/dev': proxied,
  '/client': proxied,
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  // `vite preview` (used in the web container) ignores `server.proxy`.
  preview: { proxy },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    globals: true,
  },
})
