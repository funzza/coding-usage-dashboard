/**
 * 皮肤自查截图:默认皮肤(focus)直截 Overview,再到 Settings 切 classic 回截。
 * 输出 screenshots/skin-focus.png / skin-classic.png(另附两张 Settings 页)。
 * 结束后恢复默认皮肤 focus。
 * 用法:`npx electron scripts/screenshot-skin.cjs`(首刷要等 ccusage ~150s)
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')
const INITIAL_WAIT_MS = 150_000
const NAV_WAIT_MS = 2_500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 加载应用本身(注册 IPC、创建窗口)
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
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer]', message)
  })

  const capture = async (name) => {
    try {
      const image = await win.webContents.capturePage()
      const file = join(OUT_DIR, `${name}.png`)
      writeFileSync(file, image.toPNG())
      console.log('saved', file)
    } catch (err) {
      console.error(`capture ${name} failed:`, String(err))
    }
  }

  const nav = async (hash) => {
    await win.webContents.executeJavaScript(`location.hash = '${hash}'`).catch(() => {})
    await sleep(NAV_WAIT_MS)
  }

  /** 在 Settings 点击指定皮肤的条目;返回是否找到 */
  const clickSkin = (name) =>
    win.webContents
      .executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('.skin-item')]
          .find((x) => x.querySelector('.skin-name')?.textContent.trim() === '${name}')
        if (item) item.click()
        return !!item
      })()`)
      .catch(() => false)

  // 1. 默认皮肤(focus)
  await nav('#/')
  await capture('skin-focus')
  await nav('#/settings')
  await capture('skin-focus-settings')

  // 1b. focus 下的悬浮球:折叠 + 展开
  const floatWin = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('#/float')
  )
  if (floatWin) {
    floatWin.removeAllListeners('close')
    floatWin.on('close', () => app.exit(1))
    if (!floatWin.isVisible()) floatWin.show()
    const captureFloat = async (name) => {
      try {
        const image = await floatWin.webContents.capturePage()
        const file = join(OUT_DIR, `${name}.png`)
        writeFileSync(file, image.toPNG())
        console.log('saved', file)
      } catch (err) {
        console.error(`capture ${name} failed:`, String(err))
      }
    }
    await captureFloat('skin-focus-float')
    await floatWin.webContents
      .executeJavaScript(
        `document.querySelector('.float-root')?.dispatchEvent(new MouseEvent('mouseenter'))`
      )
      .catch(() => {})
    await sleep(1200)
    await captureFloat('skin-focus-float-expanded')
  }

  // 2. 切 Classic
  console.log('click Classic:', await clickSkin('Classic'))
  await nav('#/')
  await capture('skin-classic')
  await nav('#/settings')
  await capture('skin-classic-settings')

  // 3. 恢复默认 focus
  console.log('click Focus:', await clickSkin('Focus'))

  app.exit(0)
})
