/**
 * 调试:副屏(1.25x DPI)上悬浮球的悬停振荡与拖拽增益。
 * 把球放到副屏 (-1100, 600),由 Python 移动真实鼠标配合:
 * 1) 悬停测试:光标停在球心,观察 bounds 是否振荡
 * 2) 拖拽测试:按住左键移动 125 物理 px(=100 DIP),观察窗口实际位移
 * 用法:npm run build && npx electron scripts/debug-float-oscillate.cjs
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

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
  fw.setPosition(-1100, 600)
  await sleep(1_000)
  console.log('BALL_READY', JSON.stringify(fw.getBounds()))

  const timer = setInterval(() => {
    if (!fw.isDestroyed()) console.log('BOUNDS', JSON.stringify(fw.getBounds()))
  }, 200)

  console.log('HOVER_PHASE_BEGIN') // Python 此时把光标移到球心
  await sleep(9_000)
  console.log('AWAY_PHASE_BEGIN') // Python 把光标移回主屏
  await sleep(2_000)
  console.log('DRAG_PHASE_BEGIN') // Python 执行拖拽
  await sleep(8_000)
  console.log('DONE', JSON.stringify(fw.getBounds()))

  clearInterval(timer)
  app.exit(0)
})
