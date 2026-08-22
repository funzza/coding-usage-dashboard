/**
 * 调试:定位悬浮球背后的半透明方块(GPU 合成伪影)。
 * 在副屏放纯白背景窗口,球置于其上,desktopCapturer 整屏抓图:
 *   A 原样 -> B 禁用 CSS filter -> C 禁用 CSS animation
 * 用法:npm run build && npx electron scripts/debug-float-box.cjs
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
    console.error('no float window')
    app.exit(1)
  }
  floatWin.removeAllListeners('close')

  const secondary = screen.getAllDisplays().find((d) => d.bounds.x !== 0) ?? screen.getPrimaryDisplay()
  const area = secondary.workArea

  // 纯白背景窗口(副屏全屏 + 置顶),再把球移到它之上
  const bg = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    frame: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#ffffff'
  })
  bg.loadURL(
    'data:text/html;charset=utf-8,<!DOCTYPE html><html><body style="margin:0;background:%23808080"></body></html>'
  )

  const bx = area.x + Math.round(area.width / 2) - 32
  const by = area.y + Math.round(area.height / 2) - 32
  floatWin.setPosition(bx, by)
  floatWin.moveTop()
  await sleep(1_500)

  const grab = async (name) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: secondary.size.width, height: secondary.size.height }
    })
    // source 顺序与 getAllDisplays 不一定一致,按 id 匹配
    const src = sources.find((s) => s.display_id === String(secondary.id)) ?? sources[0]
    writeFileSync(join(OUT_DIR, `${name}.png`), src.thumbnail.toPNG())
    console.log('saved', name)
  }

  await grab('debug-gray-a-plain')

  // B:只禁用 filter
  await floatWin.webContents.executeJavaScript(`(() => {
    const el = document.createElement('style')
    el.id = 'dbg-nofilter'
    el.textContent = '* { filter: none !important }'
    document.head.appendChild(el)
    return true
  })()`)
  await sleep(800)
  await grab('debug-gray-b-nofilter')
  await floatWin.webContents.executeJavaScript(`document.getElementById('dbg-nofilter')?.remove()`)

  // C:只禁用 animation
  await floatWin.webContents.executeJavaScript(`(() => {
    const el = document.createElement('style')
    el.id = 'dbg-noanim'
    el.textContent = '* { animation: none !important }'
    document.head.appendChild(el)
    return true
  })()`)
  await sleep(800)
  await grab('debug-gray-c-noanim')
  await floatWin.webContents.executeJavaScript(`document.getElementById('dbg-noanim')?.remove()`)

  // D:悬停展开态(用户报"悬浮上去有框")
  await floatWin.webContents.executeJavaScript(
    `document.querySelector('.float-root')?.dispatchEvent(new MouseEvent('mouseenter'))`
  )
  await sleep(1_200)
  await grab('debug-gray-d-expanded')
  await floatWin.webContents.executeJavaScript(
    `document.querySelector('.float-root')?.dispatchEvent(new MouseEvent('mouseleave'))`
  )
  await sleep(1_200)
  await grab('debug-gray-e-collapsed-after')

  app.exit(0)
})
