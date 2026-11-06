import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const target = 'http://localhost:8000'

// /dev and /client are both SPA pages and API prefixes: browser navigations
// (Accept: text/html) must get the SPA, fetch() calls go to the backend.
const proxied = {
  target,
  bypass: (req: { headers: { accept?: string } }) =>
    req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/setup': proxied,
      '/sim': proxied,
      '/dev': proxied,
      '/client': proxied,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    globals: true,
  },
})
