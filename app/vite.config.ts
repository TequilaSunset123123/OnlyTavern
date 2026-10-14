import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // SillyTavern serves the extension from /scripts/extensions/third-party/<folder>/,
  // so asset URLs must be relative to dist/index.html.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
