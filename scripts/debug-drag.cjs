/**
 * 拖拽区诊断:检查 .drag-head / .brand.drag-region 的 computed -webkit-app-region,
 * 以及元素中心点的命中元素(看是否被覆盖物挡住)。
 * 用法:npx electron scripts/debug-drag.cjs(需 dev server 在跑)
 */
const { app, BrowserWindow } = require('electron')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await sleep(150_000) // 等首刷(ccusage 约 17s+)
  const win =
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float')) ??
    BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('no window')
    app.exit(1)
  }

  const report = await win.webContents.executeJavaScript(`(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return { sel, found: false }
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const cx = r.left + Math.min(r.width / 2, 60)
      const cy = r.top + r.height / 2
      const hit = document.elementFromPoint(cx, cy)
      const chain = []
      let n = hit
      while (n && chain.length < 5) {
        chain.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : ''))
        n = n.parentElement
      }
      return {
        sel,
        found: true,
        appRegion: cs.getPropertyValue('-webkit-app-region'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        hitChain: chain,
        hitRegion: hit ? getComputedStyle(hit).getPropertyValue('-webkit-app-region') : null
      }
    }
    return [
      probe('header.drag-head'),
      probe('.brand.drag-region'),
      probe('main.setup.drag-region')
    ]
  })()`)
  console.log(JSON.stringify(report, null, 2))
  app.exit(0)
})
