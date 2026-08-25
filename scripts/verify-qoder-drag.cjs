/**
 * 实机验证:① Qoder 数据是否进 Overview/Settings ② 手动拖拽全链路
 * (合成 pointerdown/move/up → 检查窗口 bounds 真的移动)。
 * 用法:npx electron scripts/verify-qoder-drag.cjs(需 dev server 在跑)
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = join(__dirname, '..', 'screenshots')

app.whenReady().then(async () => {
  await sleep(150_000)
  const win =
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float')) ??
    BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('no window')
    app.exit(1)
  }
  win.removeAllListeners('close')
  win.on('close', () => app.exit(1))
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.setSize(1660, 1090)

  // ① Qoder 数据检查(snapshot.sources + agents 列表)
  const qoder = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.sidebar')
    const navText = el ? el.innerText : ''
    return {
      sidebarHasQoder: /qoder/i.test(navText),
      sidebarText: navText.slice(0, 400)
    }
  })()`)
  console.log('sidebar check:', JSON.stringify(qoder, null, 2))

  writeFileSync(join(OUT, 'verify-qoder-overview.png'), (await win.webContents.capturePage()).toPNG())

  await win.webContents.executeJavaScript(`location.hash = '#/settings'`).catch(() => {})
  await sleep(2000)
  writeFileSync(join(OUT, 'verify-qoder-settings.png'), (await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript(`location.hash = '#/'`).catch(() => {})
  await sleep(2000)

  // ② 手动拖拽全链路:合成 pointer 事件序列,验证窗口真的移动
  const before = win.getBounds()
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('header.drag-head h1') || document.querySelector('header.drag-head')
    if (!el) return 'no header'
    const r = el.getBoundingClientRect()
    const winX = window.screenX, winY = window.screenY
    const sx = winX + r.left + 50, sy = winY + r.top + 10
    const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, screenX: x, screenY: y, clientX: x - winX, clientY: y - winY })
    el.dispatchEvent(new PointerEvent('pointerdown', opts(sx, sy)))
    document.dispatchEvent(new PointerEvent('pointermove', opts(sx + 120, sy + 80)))
    document.dispatchEvent(new PointerEvent('pointermove', opts(sx + 240, sy + 160)))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }))
    return 'dispatched'
  })()`)
  await sleep(800)
  const after = win.getBounds()
  console.log('drag test: before =', JSON.stringify(before), ' after =', JSON.stringify(after))
  console.log(
    after.x !== before.x && after.y !== before.y
      ? 'DRAG OK: window moved by synthetic pointer events'
      : 'DRAG FAILED: window did not move'
  )
  app.exit(0)
})
