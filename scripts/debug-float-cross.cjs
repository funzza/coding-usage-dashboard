/**
 * 调试:按用户原始复现步骤 —— 把球从主屏(1.0x)拖过屏幕边界到副屏(1.25x),
 * 松手后悬停,观察 bounds 是否振荡。
 * 用法:npm run build && npx electron scripts/debug-float-cross.cjs
 */
const { app, BrowserWindow } = require('electron')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
process.env.DEBUG_FLOAT = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

require('../out/main/index.js')

app.whenReady().then(async () => {
  await sleep(6_000)
  const fw = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('#/float')
  )
  if (!fw) {
    console.error('no float window')
    app.exit(1)
  }
  fw.removeAllListeners('close')
  // 主屏上靠近左边界的位置,方便拖过界
  fw.setPosition(300, 600)
  await sleep(1_000)
  console.log('BALL_READY', JSON.stringify(fw.getBounds()))

  const timer = setInterval(() => {
    if (!fw.isDestroyed()) console.log('BOUNDS', JSON.stringify(fw.getBounds()))
  }, 150)

  console.log('CROSS_DRAG_BEGIN') // Python:从主屏拖到副屏
  await sleep(12_000)
  console.log('HOVER2_BEGIN') // Python:移开再悬停到球上
  await sleep(12_000)
  console.log('DONE', JSON.stringify(fw.getBounds()))

  clearInterval(timer)
  app.exit(0)
})
