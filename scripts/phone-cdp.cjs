/**
 * CDP bridge to a phone's Chrome tab over USB-C / ADB.
 *
 * Prerequisites (set up once):
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *
 * Usage:
 *   node .claude/phone-cdp.cjs <tab-url-substring> <command> [args...]
 *
 * Commands:
 *   eval <js>                    Runtime.evaluate, returns the result
 *   hud                          Shorthand for `eval document.querySelector(".m-debug-hud")?.textContent`
 *   touch-swipe <x1> <y1> <x2> <y2> <dur_ms>
 *                                Dispatch a real Input.dispatchTouchEvent sequence
 *                                (start / move / end). Coordinates are CSS px.
 *   touch-tap <x> <y>            Dispatch a touch tap at the given coordinates
 *   reload                       Page.reload (with cache bypass)
 *   screenshot <path>            Page.captureScreenshot, save to path (PNG)
 *
 * The tab is selected by URL substring match.
 */
const http = require("http")
const fs = require("fs")
const path = require("path")
const WebSocket = require(path.join(__dirname, "node_modules", "ws"))

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = ""
        res.on("data", d => (body += d))
        res.on("end", () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on("error", reject)
  })
}

async function main() {
  const [, , urlSub, cmd, ...args] = process.argv
  if (!urlSub || !cmd) {
    console.error(
      "Usage: node phone-cdp.cjs <url-substring> <cmd> [args...]",
    )
    process.exit(2)
  }
  const tabs = await httpGetJson("http://localhost:9222/json/list")
  const tab = tabs.find(t => t.type === "page" && t.url.includes(urlSub))
  if (!tab) {
    console.error(
      "No matching tab. Available URLs:",
      tabs.filter(t => t.type === "page").map(t => t.url),
    )
    process.exit(3)
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  ws.on("message", raw => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
  })
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  try {
    if (cmd === "eval") {
      const expr = args.join(" ")
      const r = await call("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) {
        console.error("EXCEPTION:", JSON.stringify(r.exceptionDetails))
        process.exit(1)
      }
      console.log(JSON.stringify(r.result?.value, null, 2))
    } else if (cmd === "hud") {
      const r = await call("Runtime.evaluate", {
        expression: 'document.querySelector(".m-debug-hud")?.textContent || "(no hud)"',
        returnByValue: true,
      })
      console.log(r.result?.value)
    } else if (cmd === "reload") {
      await call("Page.enable")
      await call("Page.reload", { ignoreCache: true })
      console.log("reloaded")
    } else if (cmd === "screenshot") {
      const out = args[0] || "phone-screenshot.png"
      const r = await call("Page.captureScreenshot", { format: "png" })
      fs.writeFileSync(out, Buffer.from(r.data, "base64"))
      console.log("wrote", out)
    } else if (cmd === "touch-tap") {
      const [x, y] = args.map(Number)
      await call("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      })
      await call("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      })
      console.log(`tapped (${x},${y})`)
    } else if (cmd === "touch-swipe") {
      const [x1, y1, x2, y2, durMs] = args.map(Number)
      const steps = Math.max(8, Math.round(durMs / 16))
      await call("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: x1, y: y1 }],
      })
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = x1 + (x2 - x1) * t
        const y = y1 + (y2 - y1) * t
        await call("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y }],
        })
        await new Promise(r => setTimeout(r, durMs / steps))
      }
      await call("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      })
      console.log(`swiped (${x1},${y1}) → (${x2},${y2}) over ${durMs}ms`)
    } else {
      console.error("Unknown command:", cmd)
      process.exit(2)
    }
  } finally {
    ws.close()
  }
}
main().catch(e => {
  console.error(e)
  process.exit(1)
})
