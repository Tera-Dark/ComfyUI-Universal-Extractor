import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/gallery/',
  build: {
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
