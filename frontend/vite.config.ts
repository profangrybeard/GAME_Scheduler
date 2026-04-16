import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `base` is set for GitHub Pages deployment at
// https://profangrybeard.github.io/GAME_Scheduler/ — assets need the repo
// sub-path prefix. Dev server doesn't need it; base only affects the
// production build output.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/GAME_Scheduler/' : '/',
  server: {
    port: 5174,
    strictPort: true,
    // Allow importing JSON from the repo root's data/ directory (one level up).
    fs: { allow: ['..'] },
  },
})
