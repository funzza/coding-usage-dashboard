/**
 * 调试:用 desktopCapturer 抓整个屏幕(OS 合成结果,含 DWM 伪影),
 * 对比悬浮球折叠/展开状态下窗口边缘是否有多余的框线。
 * 用法:先 `npm run build`,再 `npx electron scripts/debug-float-frame.cjs`
 */
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

require('../out/main/index.js')

app.whenReady().then(async () => {
  await sleep(8_000)

  const floatWin = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('#/float')
  )
  if (!floatWin) {
    console.error('float window not found')
    app.exit(1)
  }
  floatWin.removeAllListeners('close')
  // 挪到干净位置,便于在整屏图里定位
  floatWin.setPosition(300, 300)
  await sleep(1500)

  const grab = async (name) => {
    const size = screen.getPrimaryDisplay().size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: size.width, height: size.height }
    })
    const primary = sources[0]
    if (!primary || primary.thumbnail.isEmpty()) {
      console.error('grab failed')
      return
    }
    const file = join(OUT_DIR, `${name}.png`)
    writeFileSync(file, primary.thumbnail.toPNG())
    console.log('saved', file)
  }

  await grab('debug-screen-collapsed')

  await floatWin.webContents
    .executeJavaScript(
      `document.querySelector('.float-root')?.dispatchEvent(new MouseEvent('mouseenter'))`
    )
    .catch((err) => console.error('expand failed:', String(err)))
  await sleep(1500)
  await grab('debug-screen-expanded')

  app.exit(0)
})
