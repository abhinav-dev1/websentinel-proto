import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/inject': {
        target: 'http://localhost:8000',
      },
      '/health': {
        target: 'http://localhost:8000',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
