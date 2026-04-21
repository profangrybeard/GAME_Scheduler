import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Semver lives in package.json so `npm version` keeps it bumped the normal
// way. Read at config time and bake into the bundle — the About popover
// shows this as "GAME_Scheduler v<semver>" alongside the build SHA.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// Read the current commit's short SHA at config time so it can be baked into
// the bundle. In CI, actions/checkout gives us the pushed commit. Locally, it
// reflects whatever HEAD is pointing at. Falls back to "unknown" if git isn't
// available (e.g. unusual build environment).
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
//
// `base` is set for GitHub Pages deployment at
// https://profangrybeard.github.io/GAME_Scheduler/ — assets need the repo
// sub-path prefix. Dev server doesn't need it; base only affects the
// production build output.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/GAME_Scheduler/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(gitShortSha()),
    __APP_SEMVER__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5174,
    strictPort: true,
    // Allow importing JSON from the repo root's data/ directory (one level up).
    fs: { allow: ['..'] },
    // Proxy /api/* to the local FastAPI server (see api/server.py, port 8765).
    // Dev and prod share the same path this way.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
