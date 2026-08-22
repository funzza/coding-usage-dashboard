/**
 * 开发辅助:对运行中的 dev 实例截图,供自查 UI。
 * 用法:先启动 `npm run dev`,再执行 `npx electron scripts/screenshot.cjs`
 * 原理:直接加载已构建的 main bundle(带真实 IPC/数据层),
 * 通过 hash 路由切换页面并 capturePage,输出到 screenshots/。
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')

/** 首次加载会跑一次 ccusage(实测已涨到 ~100s+),等待数据就绪 */
const INITIAL_WAIT_MS = 150_000
const NAV_WAIT_MS = 2_500

const routes = [
  '/',
  '/sessions',
  '/settings'
]
const names = ['overview', 'sessions', 'settings']

/** 在 overview 上额外抓 By Model 图和侧边栏 Models 视图 */
const CLICK_MODEL_TOGGLE = `(() => {
  const btns = [...document.querySelectorAll('.dim-toggle button')]
  const b = btns.find((x) => x.textContent.trim() === 'By Model')
  if (b) b.click()
  return !!b
})()`

const CLICK_SIDEBAR_MODELS = `(() => {
  const tabs = [...document.querySelectorAll('.view-tab')]
  const t = tabs.find((x) => x.textContent.trim() === 'Models')
  if (t) t.click()
  return !!t
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 加载应用本身(注册 IPC、创建窗口)
require('../out/main/index.js')

app.whenReady().then(async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  await sleep(INITIAL_WAIT_MS)

  // 主窗口 = 不带 #/float 的窗口(悬浮球窗口也会出现在列表里)
  const win =
    BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/float')) ??
    BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('no window found')
    app.exit(1)
  }
  // 本实例是一次性截图工具:移除 main 的 close-to-hide,确保窗口可见,
  // 否则窗口被关闭/隐藏后 capturePage 会抛 UnknownVizError
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

  for (let i = 0; i < routes.length; i++) {
    await win.webContents.executeJavaScript(`location.hash = '#${routes[i]}'`).catch(() => {})
    await sleep(NAV_WAIT_MS)
    await capture(names[i])
    if (i === 0) {
      await win.webContents.executeJavaScript(CLICK_MODEL_TOGGLE).catch(() => {})
      await sleep(800)
      await capture('overview-by-model')
      await win.webContents.executeJavaScript(CLICK_SIDEBAR_MODELS).catch(() => {})
      await sleep(800)
      await capture('sidebar-models')
    }
  }

  // ---- 悬浮球:折叠态 + 模拟悬停展开态 ----
  const floatWin = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('#/float')
  )
  if (!floatWin) {
    console.error('float window not found (float-window.json enabled?)')
  } else {
    // 与主窗口同样处理:防止被关/隐藏后 capturePage 挂死
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

    await captureFloat('float-collapsed')
    // 合成 mouseenter 走正常展开链路(renderer IPC -> main 防抖 150ms -> resize)
    await floatWin.webContents
      .executeJavaScript(
        `document.querySelector('.float-root')?.dispatchEvent(new MouseEvent('mouseenter'))`
      )
      .catch((err) => console.error('float expand failed:', String(err)))
    await sleep(1200)
    await captureFloat('float-expanded')
  }

  // ---- Today 视图:横向堆叠构成对比图 ----
  const CLICK_TODAY = `(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Today')
    if (b) b.click()
    return !!b
  })()`

  // 回 Overview(组件重挂载,dimension 复位为 By Agent)
  await win.webContents.executeJavaScript(`location.hash = '#/'`).catch(() => {})
  await sleep(500)
  console.log('click Today:', await win.webContents.executeJavaScript(CLICK_TODAY).catch(() => false))
  await sleep(800)
  await capture('overview-today')
  // 从页面拿真实 agent/model 链接,比硬编码名字更稳
  const agentHref = await win.webContents
    .executeJavaScript(`document.querySelector('.rows a[href*="#/agents/"]')?.getAttribute('href') ?? ''`)
    .catch(() => '')
  await win.webContents.executeJavaScript(CLICK_MODEL_TOGGLE).catch(() => {})
  await sleep(800)
  await capture('overview-today-models')
  const modelHref = await win.webContents
    .executeJavaScript(`document.querySelector('.rows a[href*="#/model"]')?.getAttribute('href') ?? ''`)
    .catch(() => '')

  if (agentHref) {
    await win.webContents.executeJavaScript(`location.hash = '${agentHref}'`).catch(() => {})
    await sleep(500)
    await win.webContents.executeJavaScript(CLICK_TODAY).catch(() => {})
    await sleep(800)
    await capture('agent-today')
  } else {
    console.error('no agent link found, skip agent-today')
  }
  if (modelHref) {
    await win.webContents.executeJavaScript(`location.hash = '${modelHref}'`).catch(() => {})
    await sleep(500)
    await win.webContents.executeJavaScript(CLICK_TODAY).catch(() => {})
    await sleep(800)
    await capture('model-today')
  } else {
    console.error('no model link found, skip model-today')
  }

  app.exit(0)
})
