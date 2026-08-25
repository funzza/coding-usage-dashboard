import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { getLastSnapshot, setRefreshListener } from './usage/service'
import { disposeQuota, setQuotaListener, startQuotaPolling } from './quota/service'
import { setRoundsListener } from './quota/rounds'
import { createTray, updateTrayMenu } from './tray'
import { getFloatWindow, initFloat } from './float'

// main entry

let mainWindow: BrowserWindow | null = null
/** 托盘 Quit 时置 true,跳过 close-to-hide */
let quitting = false

function getWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#0d0f13',
    // 无边框:min/max/close 以 overlay 形式收进窗口右上角,保留原生 snap/快捷键行为;
    // overlay 配色随皮肤,由 renderer 通过 app:setTitlebarOverlay 同步(此处为默认皮肤 focus 的色)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0f13', symbolColor: '#8b93a1', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  // 关闭窗口时隐藏到托盘,而不是退出;托盘 Quit 才真正退出
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  const win = mainWindow
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 悬浮球单击:主窗口可见(未最小化)则隐藏,否则显示+聚焦;已被销毁则重建 */
function openMainWindow(): void {
  const win = mainWindow
  if (win && win.isVisible() && !win.isMinimized()) {
    win.hide()
    return
  }
  if (!win) createWindow()
  showWindow()
}

app.whenReady().then(() => {
  registerIpcHandlers(getWindow)
  createWindow()
  createTray(getWindow)
  initFloat({
    openMainWindow,
    onStateChanged: () => updateTrayMenu(getLastSnapshot(), getWindow)
  })

  // 每次刷新完成(无论来自 renderer、定时器还是托盘):更新托盘菜单并广播给两个窗口
  setRefreshListener((result) => {
    updateTrayMenu(result.snapshot ?? getLastSnapshot(), getWindow)
    mainWindow?.webContents.send('ccusage:refreshed', result)
    getFloatWindow()?.webContents.send('ccusage:refreshed', result)
  })

  // quota:轻量 GET,120s 轮询;完成后广播给两个窗口
  startQuotaPolling()
  setQuotaListener((snapshot) => {
    // TEMP-DIAG
    console.log(
      '[diag] quota snapshot:',
      snapshot.accounts.map((a) => `${a.provider}/${a.source}/${a.origin ?? 'win'}/${a.status}`).join(' | ')
    )
    mainWindow?.webContents.send('quota:updated', snapshot)
    getFloatWindow()?.webContents.send('quota:updated', snapshot)
  })

  // 轮次用量变化(边界/新 session 差分)广播给两个窗口
  setRoundsListener((view) => {
    mainWindow?.webContents.send('quota:rounds-updated', view)
    getFloatWindow()?.webContents.send('quota:rounds-updated', view)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 托盘 Quit 走 app.exit,不触发 before-quit 以外的逻辑
app.on('before-quit', () => {
  quitting = true
  // 停 quota 轮询并杀掉我们拉起的 kimi web sidecar
  disposeQuota()
})
