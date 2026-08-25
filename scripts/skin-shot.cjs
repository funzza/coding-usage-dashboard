/**
 * 皮肤自查截图:每个皮肤依次截 Overview / Subscriptions / Sessions / Settings。
 * 用法:`npx electron scripts/skin-shot.cjs`(需 `npm run dev` 已在跑,首刷 ~150s)
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')
const INITIAL_WAIT_MS = 150_000
const RELOAD_WAIT_MS = 12_000
const NAV_WAIT_MS = 2_000
const SKINS = ['paper', 'mono', 'neon', 'blueprint']
const PAGES = [
  ['overview', '#/'],
  ['subscriptions', '#/subscriptions'],
  ['sessions', '#/sessions'],
  ['settings', '#/settings']
]

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

  const capture = async (name) => {
    const image = await win.webContents.capturePage()
    writeFileSync(join(OUT_DIR, `${name}.png`), image.toPNG())
    console.log('saved', name)
  }

  for (const skin of SKINS) {
    try {
      await win.webContents.executeJavaScript(
        `localStorage.setItem('usage-dashboard:skin', '${skin}'); location.hash = '#/'; location.reload(); true`
      )
      await sleep(RELOAD_WAIT_MS)
      for (const [page, hash] of PAGES) {
        await win.webContents.executeJavaScript(`location.hash = '${hash}'`).catch(() => {})
        await sleep(NAV_WAIT_MS)
        await capture(`skin-live-${skin}-${page}`)
      }
    } catch (err) {
      console.error(`skin ${skin} failed:`, String(err))
    }
  }

  // 恢复默认皮肤
  await win.webContents
    .executeJavaScript(`localStorage.setItem('usage-dashboard:skin', 'focus'); location.reload(); true`)
    .catch(() => {})
  app.exit(0)
})
