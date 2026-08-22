/**
 * Overview 重构自查截图:覆盖 Today(含 24h 活动图)/ 7D / 30D / All / By Model / 详情页 / classic。
 * 用法:`npx electron scripts/redesign-shot.cjs`(首刷 ~150s + Today 的 session 加载 ~120s)
 * 注意:依赖 dev renderer(localhost:5173),需 `npm run dev` 已在跑。
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

const OUT_DIR = join(__dirname, '..', 'screenshots')
const INITIAL_WAIT_MS = 150_000
const NAV_WAIT_MS = 3_000
const SESSION_WAIT_MS = 120_000

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
      const file = join(OUT_DIR, `${name}.png`)
      writeFileSync(file, image.toPNG())
      console.log('saved', file)
    } catch (err) {
      console.error(`capture ${name} failed:`, String(err))
    }
  }

  /** 点击文本匹配的按钮(限定 selector 范围内) */
  const clickByText = (selector, text) =>
    win.webContents
      .executeJavaScript(`(() => {
        const el = [...document.querySelectorAll('${selector}')]
          .find((x) => x.textContent.trim() === '${text}')
        if (el) el.click()
        return !!el
      })()`)
      .catch(() => false)

  const nav = async (hash) => {
    await win.webContents.executeJavaScript(`location.hash = '${hash}'`).catch(() => {})
    await sleep(NAV_WAIT_MS)
  }

  await nav('#/')

  // 1. Today(agent 维度;session 数据首次加载要等)
  console.log('range Today:', await clickByText('.head-controls .tab', 'Today'))
  await sleep(SESSION_WAIT_MS)
  await capture('redesign-today')

  // 2. Today + By Model
  console.log('dim By Model:', await clickByText('.head-controls .tab', 'By Model'))
  await sleep(1500)
  await capture('redesign-today-model')
  await clickByText('.head-controls .tab', 'By Agent')

  // 3. 30D(默认维度 agents)
  console.log('range 30D:', await clickByText('.head-controls .tab', '30D'))
  await sleep(2000)
  await capture('redesign-30d')

  // 4. 30D + By Model
  await clickByText('.head-controls .tab', 'By Model')
  await sleep(1500)
  await capture('redesign-30d-model')
  await clickByText('.head-controls .tab', 'By Agent')

  // 5. 7D
  console.log('range 7D:', await clickByText('.head-controls .tab', '7D'))
  await sleep(2000)
  await capture('redesign-7d')

  // 6. All(趋势/漂移默认按周)
  console.log('range All:', await clickByText('.head-controls .tab', 'All'))
  await sleep(2000)
  await capture('redesign-all')

  // 7. Agent 详情页(侧栏第一个 agent)
  await clickByText('.head-controls .tab', '30D')
  await sleep(1500)
  console.log(
    'agent nav:',
    await win.webContents
      .executeJavaScript(`(() => {
        const el = document.querySelector('.nav-item.agent')
        if (el) el.click()
        return !!el
      })()`)
      .catch(() => false)
  )
  await sleep(NAV_WAIT_MS)
  await capture('redesign-agent-detail')

  // 8. Agent 详情 Today 态(donut)
  await clickByText('.head .tab', 'Today')
  await sleep(2000)
  await capture('redesign-agent-detail-today')

  // 9. classic 皮肤下回截 30D + Today
  await nav('#/settings')
  console.log(
    'classic:',
    await win.webContents
      .executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('.skin-item')]
          .find((x) => x.querySelector('.skin-name')?.textContent.trim() === 'Classic')
        if (item) item.click()
        return !!item
      })()`)
      .catch(() => false)
  )
  await nav('#/')
  await clickByText('.head-controls .tab', '30D')
  await sleep(2000)
  await capture('redesign-classic-30d')
  await clickByText('.head-controls .tab', 'Today')
  await sleep(2000)
  await capture('redesign-classic-today')

  // 恢复 focus
  await nav('#/settings')
  await win.webContents
    .executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.skin-item')]
        .find((x) => x.querySelector('.skin-name')?.textContent.trim() === 'Focus')
      if (item) item.click()
      return !!item
    })()`)
    .catch(() => false)

  app.exit(0)
})
