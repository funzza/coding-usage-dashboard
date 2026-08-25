/**
 * QuotaStrip / Subscriptions 页 / Settings 瘦身 的自查截图。
 * 用法:`npx electron scripts/quota-shot.cjs`(需 `npm run dev` 已在跑,首刷 ~150s)
 * 注:capturePage 不含原生 caption overlay 按钮,无边框效果以实际窗口为准。
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')
const INITIAL_WAIT_MS = 150_000
const NAV_WAIT_MS = 2_500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

require('../out/main/index.js')

app.whenReady().then(async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  await sleep(INITIAL_WAIT_MS)

  const win =
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float')) ??
    BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('no window found')
    app.exit(1)
  }
  win.removeAllListeners('close')
  win.on('close', () => app.exit(1))
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.setSize(1660, 1090)
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer]', message)
  })

  const capture = async (name) => {
    try {
      const image = await win.webContents.capturePage()
      writeFileSync(join(OUT_DIR, `${name}.png`), image.toPNG())
      console.log('saved', name)
    } catch (err) {
      console.error(`capture ${name} failed:`, String(err))
    }
  }

  const nav = async (hash) => {
    await win.webContents.executeJavaScript(`location.hash = '${hash}'`).catch(() => {})
    await sleep(NAV_WAIT_MS)
  }

  await nav('#/')
  await capture('quota-strip-overview')
  await nav('#/subscriptions')
  await capture('quota-subscriptions')
  await nav('#/settings')
  await capture('quota-settings')
  await nav('#/')

  app.exit(0)
})
