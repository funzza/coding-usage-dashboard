/**
 * 诊断:同一实例下,分别在小窗口与最大化尺寸量 Today's Activity 图表
 * (canvas)与面板的实际宽度,复现"最大化后图表反而缩小"。
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const MEASURE = `(() => {
  const panels = [...document.querySelectorAll('.panel')]
  const activityPanel = panels.find((p) => p.textContent.includes("Today's Activity"))
  const canvas = activityPanel ? activityPanel.querySelector('canvas') : null
  const grid = document.querySelector('.page')
  return {
    bodyW: document.body.clientWidth,
    pageW: grid ? grid.clientWidth : null,
    panelW: activityPanel ? activityPanel.clientWidth : null,
    canvasW: canvas ? canvas.clientWidth : null,
    canvasH: canvas ? canvas.clientHeight : null,
    dpr: window.devicePixelRatio,
    innerW: window.innerWidth,
    rowsW: (() => { const r = document.querySelector('.rows'); return r ? r.clientWidth : null })(),
    compW: (() => { const c = document.querySelector('.rows .comp'); return c ? c.clientWidth : null })(),
    gridCols: (() => { const g = document.querySelector('.share-grid'); return g ? getComputedStyle(g).gridTemplateColumns : null })()
  }
})()`

app.whenReady().then(async () => {
  // 复用已构建 main bundle:真实 IPC/数据层;等待数据就绪
  require(join(__dirname, '..', 'out', 'main', 'index.js'))
  await new Promise((r) => setTimeout(r, 150_000))

  const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float'))
  if (!win) {
    console.log('no main window')
    app.quit()
    return
  }
  // 回到 Overview + Today
  win.webContents.executeJavaScript(`location.hash = '#/'`)
  await new Promise((r) => setTimeout(r, 2_000))

  win.setBounds({ width: 1280, height: 820 })
  await new Promise((r) => setTimeout(r, 1_500))
  console.log('SMALL   :', JSON.stringify(await win.webContents.executeJavaScript(MEASURE)))

  console.log('bounds-before:', JSON.stringify(win.getBounds()), 'zoom=', win.webContents.getZoomFactor())
  win.maximize()
  await new Promise((r) => setTimeout(r, 2_500))
  console.log('bounds-after:', JSON.stringify(win.getBounds()), 'maximized=', win.isMaximized(), 'zoom=', win.webContents.getZoomFactor())
  console.log('MAXIMIZE:', JSON.stringify(await win.webContents.executeJavaScript(MEASURE)))

  app.quit()
})
