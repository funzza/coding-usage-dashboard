/**
 * 拖拽回归 v2:轮询等 header,合成 pointer 事件核对窗口位移与尺寸稳定。
 * 不抢焦点不弹窗;窗口被关(误关)会明确报 DESTROYED 而不是假失败。
 * 用法:npx electron scripts/verify-drag.cjs(需 dev server 在跑,且 out/main 为最新构建)
 */
const { app, BrowserWindow } = require('electron')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await sleep(3000) // 等窗口创建
  const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float'))
  if (!win) {
    console.error('no window')
    app.exit(1)
  }
  win.removeAllListeners('close')
  win.on('close', () => app.exit(2))
  if (win.isMinimized()) win.restore()

  let ready = false
  let lastState = ''
  for (let i = 0; i < 90; i++) {
    if (win.isDestroyed()) {
      console.error('DESTROYED: test window was closed mid-run')
      app.exit(2)
    }
    await sleep(2000)
    try {
      const state = await win.webContents.executeJavaScript(
        `document.querySelector('header.drag-head') ? 'ready' : (document.body.innerText || '').slice(0, 120)`
      )
      lastState = typeof state === 'string' ? state : ''
      if (state === 'ready') {
        ready = true
        break
      }
    } catch (err) {
      lastState = `error: ${String(err).slice(0, 80)}`
    }
  }
  if (!ready) {
    console.error('header never appeared; last page state:', JSON.stringify(lastState))
    app.exit(1)
  }

  const before = win.getBounds()
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('header.drag-head h1') || document.querySelector('header.drag-head')
    const r = el.getBoundingClientRect()
    const winX = window.screenX, winY = window.screenY
    const sx = winX + r.left + 50, sy = winY + r.top + 10
    const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, screenX: x, screenY: y, clientX: x - winX, clientY: y - winY })
    el.dispatchEvent(new PointerEvent('pointerdown', opts(sx, sy)))
    for (let i = 1; i <= 10; i++) {
      document.dispatchEvent(new PointerEvent('pointermove', opts(sx + i * 50, sy + i * 30)))
    }
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }))
    return true
  })()`)
  await sleep(800)
  const after = win.getBounds()
  const moved = after.x !== before.x && after.y !== before.y
  // Windows DIP 取整:首轮 setBounds 可能有一次性 ±1 DIP 舍入;关键是不能随移动次数累积
  const leakX = Math.abs(after.width - before.width)
  const leakY = Math.abs(after.height - before.height)
  const sizeStable = leakX <= 1 && leakY <= 1
  console.log('before =', JSON.stringify(before), ' after =', JSON.stringify(after))
  console.log(moved ? 'DRAG OK: window moved' : 'DRAG FAILED: no move')
  console.log(
    sizeStable
      ? `SIZE OK: no cumulative leak over 10 moves (delta ${leakX}x${leakY}, one-time DIP rounding)`
      : `SIZE LEAK: ${before.width}x${before.height} -> ${after.width}x${after.height} over 10 moves`
  )
  app.exit(moved && sizeStable ? 0 : 1)
})
