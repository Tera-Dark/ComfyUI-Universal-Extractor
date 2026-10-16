import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/gallery/',
  build: {
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
  },
  plugins: [
    { name: 'installed-release-version', generateBundle() {
      const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
      this.emitFile({ type: 'asset', fileName: 'release-version.json', source: JSON.stringify({ version }) })
    } },
    react(),
    tailwindcss(),
  ],
})
