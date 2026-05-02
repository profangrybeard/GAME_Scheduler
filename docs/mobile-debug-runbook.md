# Mobile Debug Runbook

How to reproduce the working mobile-debugging pipeline used during the Path C
mobile rebuild (branch `mobile-rebuild`, 2026-05-02). The setup gives the
agent direct read/control access to a real Android phone while iterating on
mobile-specific gesture and layout code that DevTools mobile emulation
cannot fully reproduce.

> **TL;DR** — phone over USB-C → ADB forwards Chrome DevTools Protocol →
> Node script speaks CDP → agent reads HUD, dispatches real touch events,
> takes screenshots. Web app is served over Cloudflare Quick Tunnels so the
> phone can reach `localhost` from any network.

---

## 1. Why this exists

DevTools mobile emulation simulates pointer events with a mouse, which fires
the **modern, well-behaved** event sequence: `pointerdown / pointermove* /
pointerup`. That's not what real Android Chrome does.

On a Samsung S24 Ultra (Chrome 147, Android stock) the actual sequence
during a horizontal swipe is:

```
pointerdown  →  touchstart  →  pointermove  →  touchmove  →
pointercancel  →  touchmove × N  →  touchend
```

Chrome speculatively decides "this gesture might be a scroll" and **fires
`pointercancel`** mid-drag while leaving touch events streaming. Any
gesture handler that registers pointer events alone (or that lets pointer
events claim the gesture and clears state on `pointercancel`) loses every
swipe on Android. We didn't see this on desktop, in DevTools, or in the
agent's own preview tools — only on the real phone.

The pipeline below let us prove that, fix it, and verify the fix without
asking the user to read HUD output back to the agent.

---

## 2. Prerequisites (one-time)

| Need | How |
|---|---|
| `adb` (Android Debug Bridge) | Android SDK platform-tools. Already at `C:\Users\rinds\AppData\Local\Android\Sdk\platform-tools\adb.exe` on the dev machine. |
| `node` (≥ 22) | Already installed for Vite. |
| `cloudflared` | Single binary download from `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe`. Cached in `$env:TEMP\cloudflared.exe`. |
| `ws` (Node WebSocket client) | Declared in `scripts/package.json`. Run `npm install` in `scripts/` once. |
| Phone in dev mode | Settings → About phone → tap *Build number* 7× → back → Developer options → enable *USB debugging*. |
| Phone authorized | First `adb` command from a new desktop triggers an *Allow USB debugging?* prompt on the phone. Tap **Allow** with *always allow* checked. |

---

## 3. Bring-up sequence

Run these in order from the repo root. Each step is independent enough that
you can re-run the later steps without touching the earlier ones.

### 3.1 Vite dev server (background bash, NOT preview tool)

The agent's `preview_start` tool kept killing this server. Launch via plain
background bash so Vite owns its own lifetime:

```bash
cd frontend && npm run dev > /tmp/vite.log 2>&1 &
disown
```

Verify it bound to all interfaces:

```powershell
netstat -ano -p tcp | Select-String "LISTENING" | Select-String "5174"
# expect:  TCP    0.0.0.0:5174   ...   LISTENING   <PID>
```

`vite.config.ts` already includes:

```ts
server: {
  host: true,                       // bind to 0.0.0.0
  allowedHosts: ['.trycloudflare.com'],  // accept tunnel host header
}
```

Without `allowedHosts`, the tunnel returns **HTTP 403** — Vite's default
DNS-rebinding protection. The leading `.` makes it a wildcard match for any
`*.trycloudflare.com` subdomain, which Cloudflare regenerates per session.

### 3.2 Cloudflare Quick Tunnel

```powershell
$out = "$env:TEMP\cloudflared-out.log"
$err = "$env:TEMP\cloudflared-err.log"
Get-ChildItem $out, $err -ErrorAction SilentlyContinue | Remove-Item

$proc = Start-Process `
  -FilePath "$env:TEMP\cloudflared.exe" `
  -ArgumentList @("tunnel", "--url", "http://localhost:5174", "--no-autoupdate") `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 6
Get-Content $err | Select-String "trycloudflare.com"
```

The URL printed in stderr (e.g. `https://releases-she-citations-defining.trycloudflare.com`)
is good for the lifetime of the cloudflared process. **It changes on every
restart**; quick tunnels are anonymous and unstable on purpose. Hand it to
the user / open it on the phone.

Self-test from the desktop before handing it off:

```powershell
(Invoke-WebRequest -Uri "<tunnel-url>" -UseBasicParsing -TimeoutSec 8).StatusCode
# expect: 200
```

If it returns **403**, `allowedHosts` isn't picking up `.trycloudflare.com`
— check `frontend/vite.config.ts` and restart Vite.

### 3.3 ADB + Chrome DevTools Protocol forwarding

Plug phone in via USB-C. Then:

```powershell
& adb devices -l
# expect a line like:  R5CX21RW3EW   device   product:e3qsqw   model:SM_S928U   ...

& adb forward tcp:9222 localabstract:chrome_devtools_remote
# expect echo:  9222
```

Verify CDP is talking:

```powershell
(Invoke-WebRequest -Uri "http://localhost:9222/json/version" -UseBasicParsing).Content
# expect Chrome version JSON
```

Open the tunnel URL on the phone's Chrome, then list available targets:

```powershell
Invoke-RestMethod -Uri "http://localhost:9222/json/list" |
  Where-Object { $_.type -eq 'page' } |
  Select-Object id, title, url
```

The tab serving the tunnel URL is what the bridge will attach to.

### 3.4 The CDP bridge

`scripts/phone-cdp.cjs` is a tiny Node script that opens a WebSocket to the
phone tab and exposes a small command surface. Source is checked into the
repo; `ws` is its only dependency, declared in `scripts/package.json`. Run
`npm install` inside `scripts/` once.

Available commands:

```bash
# Read the on-page debug HUD (or any DOM expression)
node scripts/phone-cdp.cjs trycloudflare hud
node scripts/phone-cdp.cjs trycloudflare eval "document.title"

# Drive a real touch swipe (CDP Input.dispatchTouchEvent — fires real
# touchstart/touchmove*/touchend the page sees as native touches)
node scripts/phone-cdp.cjs trycloudflare touch-swipe 300 500 100 500 300
#   args: x1 y1 x2 y2 duration_ms

# Tap, reload, screenshot
node scripts/phone-cdp.cjs trycloudflare touch-tap 100 200
node scripts/phone-cdp.cjs trycloudflare reload
node scripts/phone-cdp.cjs trycloudflare screenshot phone.png
```

The first argument (`trycloudflare`) is a **substring match** against the
tab URL; the script picks the first page tab whose URL contains it.

---

## 4. Lessons baked into the code

These survived from the debugging arc and live in `frontend/src/mobile/`
permanently. Each one was load-bearing on a real phone.

### 4.1 Pointer events for mouse/pen, touch events for touch

In `ScheduleScreen.tsx`'s pager handlers, the pointer handlers early-return
when `e.pointerType === 'touch'`:

```ts
const onPointerDown = (e) => {
  if (e.pointerType === "touch") return  // touch handlers own this
  // ... mouse / S-Pen path
}
```

**Why:** Android Chrome fires `pointercancel` mid-drag during touch
gestures. Letting pointer handlers claim the gesture means a stray cancel
clears `startRef`, and the dozen `touchmove` events that follow run
against null state ("move-no-start"). With this guard, only the touch
path sees touch gestures and the cancel never matters.

### 4.2 Source-tagged gestures

`startGesture(x, y, t, source)` records which event family owns the
gesture in `sourceRef`. `cancelGesture(source)` and `endGesture(..., source)`
no-op if the source doesn't match. Belt-and-braces for the same Android
issue and for any future hybrid input scenario (touch + S Pen mid-stroke).

### 4.3 `touch-action: pan-y` on the pager, NOT `none`

`touch-action: pan-y` lets the browser handle vertical scroll inside the
pages natively while keeping horizontal pan for our handlers. We tried
`touch-action: none` during diagnosis — touch events still didn't fire,
so it wasn't the bottleneck, but `pan-y` is the right semantic.

### 4.4 Vite needs `allowedHosts` for tunnels

Already covered in §3.1. Without this, the entire pipeline silently
fails with HTTP 403 from inside the tunnel.

---

## 5. Failed paths (don't retry)

| Tried | Why it didn't work |
|---|---|
| LAN-only testing on `192.168.x.x` | Cloudflare WARP / NordVPN tunnel interfaces hijack default routes, so phone packets to the laptop get black-holed. Gave up after multiple network swaps. Tunnel is more robust than LAN even on a clean network. |
| `preview_start` for Vite | Agent's preview manager kept killing the dev server. Plain `&` background bash survives. |
| `winget install` for cloudflared | Slower than the direct binary download; needs admin on some configs. The `cloudflared-windows-amd64.exe` from GitHub releases is a single 65 MB binary, no install. |
| Pointer events alone (no touch fallback) | Loses every Android swipe via the `pointercancel` mid-drag. |
| Single shared gesture state across families without source tagging | A `pointercancel` from Chrome's scroll-detection nukes the state even though touch events keep firing. |

---

## 6. Cleanup when you're done

```powershell
# Stop cloudflared (PID was captured in $proc)
Stop-Process -Id <cloudflared-pid> -Force

# Stop Vite (PID found via netstat -ano on port 5174)
Get-NetTCPConnection -LocalPort 5174 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Drop the ADB forward (optional — adb cleans up when phone unplugs)
& adb forward --remove tcp:9222
```

`scripts/node_modules/` and `scripts/phone-cdp.cjs` stay on disk for next
session — they're cheap to keep.

---

## 7. Future improvements

- Wrap §3.1–§3.3 into a single PowerShell script (`scripts/mobile-debug-up.ps1`)
  so bring-up is one command.
- Add `mobile-debug-down.ps1` for §6.
- Consider a stable named cloudflared tunnel (requires Cloudflare account)
  so the URL is stable across sessions — only worth doing if the testing
  loop becomes routine.
- The on-page debug HUD (`m-debug-hud` div in `ScheduleScreen.tsx`) is
  diagnostic-only and should be pulled before merging to `main`. It's left
  in for now because the mobile rebuild is still active and the pipeline
  is the iteration loop.
