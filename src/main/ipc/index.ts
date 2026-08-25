import { app, BrowserWindow, ipcMain } from 'electron'
import { detectCcusage, detectWslCcusage, getLastSnapshot, getSessions, refreshUsage } from '../usage/service'
import type { DetectResult, RefreshResult, SessionsResult, UsageSnapshot } from '../../shared/usage-model'
import {
  addQuotaAccount,
  getQuotaAccountViews,
  getQuotaSnapshot,
  refreshQuota,
  removeQuotaAccount,
  setQuotaAccountEnabled
} from '../quota/service'
import { getRoundsView, ingestSessions } from '../quota/rounds'
import type { QuotaAccount, QuotaAccountConfigView, QuotaProviderId, QuotaSnapshot, RoundsView } from '../quota/types'

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('ccusage:detect', (): Promise<DetectResult> => {
    // WSL 侧定位缓存一并刷新(后台进行,不阻塞 Windows 探测返回)
    void detectWslCcusage(true)
    return detectCcusage(true)
  })
  ipcMain.handle('ccusage:refresh', (): Promise<RefreshResult> => refreshUsage())
  // 悬浮球等被动窗口取缓存快照,不触发刷新
  ipcMain.handle('ccusage:snapshot', (): UsageSnapshot | null => getLastSnapshot())
  // Sessions 页面按需加载(session 子命令单次约 1-2 分钟,绝不并入常规刷新);
  // 报告同时喂给轮次状态机(内部以 generatedAt 判重,不会重复消费)
  ipcMain.handle('usage:sessions', async (): Promise<SessionsResult> => {
    const result = await getSessions()
    void ingestSessions(result.report)
    return result
  })

  // quota:轮询在主进程,renderer 只取缓存/订阅广播
  ipcMain.handle('quota:get', (): QuotaSnapshot | null => getQuotaSnapshot())
  ipcMain.handle('quota:refresh', (): Promise<QuotaSnapshot> => refreshQuota())
  // 轮次用量(当前轮/上一轮/历史),主进程状态机维护
  ipcMain.handle('quota:getRounds', (): RoundsView => getRoundsView())

  // quota 账号管理:配置视图不含 token;新增 manual 账号会先验证 token 再落盘
  ipcMain.handle('quota:getConfig', (): QuotaAccountConfigView[] => getQuotaAccountViews())
  ipcMain.handle('quota:setEnabled', (_e, accountId: string, enabled: boolean): Promise<void> =>
    setQuotaAccountEnabled(String(accountId), Boolean(enabled))
  )
  ipcMain.handle(
    'quota:addAccount',
    (_e, provider: QuotaProviderId, label: string, token: string): Promise<QuotaAccount> =>
      addQuotaAccount(provider, String(label ?? ''), String(token ?? ''))
  )
  ipcMain.handle('quota:removeAccount', (_e, accountId: string): Promise<void> =>
    removeQuotaAccount(String(accountId))
  )

  // 开机自启动:Windows 下 Electron 走注册表 Run 键,无需额外持久化。
  // dev 态下注册的是 electron.exe 本身(path 指向开发二进制),属平台常态,不做特殊处理。
  ipcMain.handle('app:getAutoLaunch', (): boolean => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:setAutoLaunch', (_e, enabled: boolean): void => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
  })

  // 无边框窗口右上角的 caption 按钮(min/max/close)配色随皮肤同步;height 建窗时定,运行期只改色
  ipcMain.handle('app:setTitlebarOverlay', (_e, color: string, symbolColor: string): void => {
    getMainWindow()?.setTitleBarOverlay({
      color: String(color),
      symbolColor: String(symbolColor)
    })
  })

  // ---- 无边框窗口手动拖拽 ----
  // 与悬浮球同一套实现(指针捕获 + setBounds),CSS app-region 失效时的可靠兜底;
  // 原生拖拽生效时 OS 拿走鼠标事件,这里收不到 pointerdown,两套机制不冲突。
  let windowDrag: {
    win: BrowserWindow
    startScreenX: number
    startScreenY: number
    startWinX: number
    startWinY: number
    startWinW: number
    startWinH: number
  } | null = null

  const toFiniteInt = (value: unknown): number | null => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.round(n) : null
  }

  ipcMain.on('app:windowDragStart', (event, screenX: unknown, screenY: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sx = toFiniteInt(screenX)
    const sy = toFiniteInt(screenY)
    if (!win || sx === null || sy === null) return
    if (win.isMaximized()) {
      // 从最大化拖下:先还原,让光标按原横向相对位置落在还原后的窗口上
      const maxBounds = win.getBounds()
      win.unmaximize()
      const [w] = win.getSize()
      const ratioX = maxBounds.width > 0 ? (sx - maxBounds.x) / maxBounds.width : 0.5
      win.setPosition(Math.round(sx - w * ratioX), Math.round(sy - 12))
    }
    const bounds = win.getBounds()
    windowDrag = {
      win,
      startScreenX: sx,
      startScreenY: sy,
      startWinX: bounds.x,
      startWinY: bounds.y,
      startWinW: bounds.width,
      startWinH: bounds.height
    }
  })

  ipcMain.on('app:windowDragMove', (_event, screenX: unknown, screenY: unknown) => {
    const sx = toFiniteInt(screenX)
    const sy = toFiniteInt(screenY)
    if (!windowDrag || sx === null || sy === null || windowDrag.win.isDestroyed()) return
    // setBounds 的尺寸固定为拖拽起点时 getBounds() 的值(窗口尺寸,不是 getSize() 的内容尺寸):
    // 非 100% DPI 屏上每次重取尺寸都会因物理像素取整让窗口 +1 DIP
    windowDrag.win.setBounds({
      x: windowDrag.startWinX + (sx - windowDrag.startScreenX),
      y: windowDrag.startWinY + (sy - windowDrag.startScreenY),
      width: windowDrag.startWinW,
      height: windowDrag.startWinH
    })
  })

  ipcMain.on('app:windowDragEnd', () => {
    windowDrag = null
  })

  ipcMain.on('app:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
}
