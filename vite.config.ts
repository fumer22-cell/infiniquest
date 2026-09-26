import { defineConfig } from 'vite';

// The client never talks to Anthropic directly: /api is proxied to the local Express server.
export default defineConfig({
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
