import { BrowserWindow, Menu, app, ipcMain, screen } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { refreshUsage } from '../usage/service'
import {
  DEFAULT_FLOAT_CONFIG,
  FLOAT_SIZE_PX,
  type FloatConfig
} from '../../shared/float-config'

export type { FloatAnimation, FloatColorMode, FloatConfig, FloatSize } from '../../shared/float-config'

/**
 * 悬浮球窗口:折叠态圆球(默认 64x64,可配置 48/80),悬停展开为 320x330 面板
 * (Today 各 agent + 订阅 quota 行)。
 * - 展开方向朝屏幕中心(由窗口所在半屏决定)
 * - 拖拽由 renderer 转发屏幕坐标,位移 <5px 的 mouseup 视为单击
 * - 状态与外观配置持久化到 userData/float-window.json
 */
const EXPANDED_WIDTH = 320
const EXPANDED_HEIGHT = 330
const EXPAND_DEBOUNCE_MS = 150
const COLLAPSE_DEBOUNCE_MS = 300
const CLICK_TOLERANCE_PX = 5

/** 球在窗口内的锚角;展开后面板位于其对侧 */
export interface FloatAnchor {
  horizontal: 'left' | 'right'
  vertical: 'top' | 'bottom'
}

export interface FloatState {
  enabled: boolean
}

interface FloatPersist extends FloatConfig {
  enabled: boolean
  x?: number
  y?: number
}

interface FloatCallbacks {
  /** 打开/聚焦主 Dashboard(mainWindow 为 null 时由调用方重建) */
  openMainWindow: () => void
  /** enabled 变化后回调(刷新托盘 checkbox) */
  onStateChanged: () => void
}

interface DragState {
  startScreenX: number
  startScreenY: number
  startWinX: number
  startWinY: number
  moved: boolean
}

let floatWindow: BrowserWindow | null = null
let callbacks: FloatCallbacks | null = null
let persist: FloatPersist = { enabled: true, ...DEFAULT_FLOAT_CONFIG }
let expanded = false
let menuOpen = false
let collapsedBounds: Electron.Rectangle | null = null
let expandTimer: ReturnType<typeof setTimeout> | null = null
let pendingResolvers: Array<(anchor: FloatAnchor) => void> = []
let drag: DragState | null = null

/** 多屏 DPI 缩放不同时 screenX/Y 可能带小数;setPosition 只接受整数,NaN/小数会直接抛异常 */
function toFiniteInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

function persistPath(): string {
  return join(app.getPath('userData'), 'float-window.json')
}

function loadPersist(): void {
  try {
    const raw = JSON.parse(readFileSync(persistPath(), 'utf-8')) as Partial<FloatPersist>
    if (typeof raw.enabled === 'boolean') persist.enabled = raw.enabled
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      persist.x = raw.x
      persist.y = raw.y
    }
    // 老版本文件没有外观字段:只覆盖合法值,其余留默认(向后兼容)
    if (raw.size === 's' || raw.size === 'm' || raw.size === 'l') persist.size = raw.size
    if (typeof raw.opacity === 'number' && raw.opacity >= 0.4 && raw.opacity <= 1) {
      persist.opacity = raw.opacity
    }
    if (raw.animation === 'lively' || raw.animation === 'calm') persist.animation = raw.animation
    if (raw.colorMode === 'adaptive' || raw.colorMode === 'fixed') persist.colorMode = raw.colorMode
  } catch {
    // 文件不存在或损坏:用默认值
  }
}

function savePersist(): void {
  try {
    const file = persistPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(persist), 'utf-8')
  } catch {
    // 持久化失败不影响功能
  }
}

export function getFloatWindow(): BrowserWindow | null {
  return floatWindow
}

/** 当前折叠态边长(px) */
function collapsedSize(): number {
  return FLOAT_SIZE_PX[persist.size]
}

function currentConfig(): FloatConfig {
  return {
    size: persist.size,
    opacity: persist.opacity,
    animation: persist.animation,
    colorMode: persist.colorMode
  }
}

export function isFloatEnabled(): boolean {
  return persist.enabled
}

export function setFloatEnabled(enabled: boolean): void {
  persist.enabled = enabled
  savePersist()
  if (enabled) {
    createFloatWindow()
  } else {
    expanded = false
    floatWindow?.close()
  }
  callbacks?.onStateChanged()
}

/** 合并外观配置(实时生效):持久化、size 变化时调整窗口、推送给悬浮球窗口 */
function updateFloatConfig(partial: Partial<FloatConfig>): FloatConfig {
  const sizeChanged = partial.size !== undefined && partial.size !== persist.size
  if (partial.size === 's' || partial.size === 'm' || partial.size === 'l') persist.size = partial.size
  if (typeof partial.opacity === 'number' && Number.isFinite(partial.opacity)) {
    persist.opacity = Math.min(1, Math.max(0.4, partial.opacity))
  }
  if (partial.animation === 'lively' || partial.animation === 'calm') {
    persist.animation = partial.animation
  }
  if (partial.colorMode === 'adaptive' || partial.colorMode === 'fixed') {
    persist.colorMode = partial.colorMode
  }
  savePersist()

  const win = floatWindow
  if (win && sizeChanged) {
    // 展开态先收回,再以球心为锚 resize 到新尺寸
    if (expanded) applyExpanded(false)
    const b = win.getBounds()
    const size = collapsedSize()
    win.setBounds({
      x: Math.round(b.x + b.width / 2 - size / 2),
      y: Math.round(b.y + b.height / 2 - size / 2),
      width: size,
      height: size
    })
  }
  win?.webContents.send('float:config', currentConfig())
  return currentConfig()
}

/** 应用启动时初始化:读取持久化状态、注册 IPC、按需创建悬浮球 */
export function initFloat(cb: FloatCallbacks): void {
  callbacks = cb
  loadPersist()
  registerFloatIpc()
  if (persist.enabled) createFloatWindow()
}

function createFloatWindow(): void {
  if (floatWindow) return
  const size = collapsedSize()
  const { x, y } = initialPosition()
  const win = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    // Windows 11 的 DWM 会给无边框窗口画系统强调色描边+圆角,
    // 在透明窗口上表现为球体四周的紫色框线,必须关掉
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  floatWindow = win
  win.on('closed', () => {
    floatWindow = null
    expanded = false
    collapsedBounds = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + '#/float')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/float' })
  }
}

/** 默认放在主屏工作区右下角 */
function initialPosition(): { x: number; y: number } {
  if (persist.x !== undefined && persist.y !== undefined) {
    return { x: persist.x, y: persist.y }
  }
  const size = collapsedSize()
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - size - 24,
    y: area.y + area.height - size - 24
  }
}

/** 根据球所在半屏决定锚角:左半屏往右扩,上半屏往下扩 */
function computeAnchor(): FloatAnchor {
  const bounds = collapsedBounds ?? floatWindow?.getBounds()
  if (!bounds) return { horizontal: 'left', vertical: 'bottom' }
  const size = collapsedSize()
  const center = {
    x: bounds.x + size / 2,
    y: bounds.y + size / 2
  }
  const area = screen.getDisplayNearestPoint(center).workArea
  return {
    horizontal: center.x < area.x + area.width / 2 ? 'left' : 'right',
    vertical: center.y < area.y + area.height / 2 ? 'top' : 'bottom'
  }
}

function expandedBounds(collapsed: Electron.Rectangle, anchor: FloatAnchor): Electron.Rectangle {
  const size = collapsedSize()
  const area = screen.getDisplayNearestPoint({
    x: collapsed.x + size / 2,
    y: collapsed.y + size / 2
  }).workArea
  let x = anchor.horizontal === 'left' ? collapsed.x : collapsed.x + size - EXPANDED_WIDTH
  let y = anchor.vertical === 'top' ? collapsed.y : collapsed.y + size - EXPANDED_HEIGHT
  // 边缘场景收进工作区
  x = Math.min(Math.max(x, area.x), area.x + area.width - EXPANDED_WIDTH)
  y = Math.min(Math.max(y, area.y), area.y + area.height - EXPANDED_HEIGHT)
  return { x, y, width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }
}

/** 临时诊断:DEBUG_FLOAT=1 时输出展开/拖拽的几何数据 */
function dlog(...args: unknown[]): void {
  if (process.env.DEBUG_FLOAT) console.log('[float]', ...args)
}

function applyExpanded(next: boolean): void {
  const win = floatWindow
  if (!win || next === expanded) return
  if (next) {
    collapsedBounds = win.getBounds()
    const target = expandedBounds(collapsedBounds, computeAnchor())
    dlog('expand', JSON.stringify({ collapsed: collapsedBounds, target }))
    win.setBounds(target)
    dlog('expand applied', JSON.stringify(win.getBounds()))
  } else if (collapsedBounds) {
    dlog('collapse', JSON.stringify(collapsedBounds))
    win.setBounds(collapsedBounds)
    dlog('collapse applied', JSON.stringify(win.getBounds()))
  }
  expanded = next
}

/** renderer 悬停通知:展开 150ms / 折叠 300ms 防抖,完成后回复锚角 */
function handleSetExpanded(next: boolean): Promise<FloatAnchor> {
  // 右键菜单打开期间不折叠,避免窗口在菜单下收缩
  if (!next && menuOpen) return Promise.resolve(computeAnchor())
  // 拖拽期间挂起悬停展开/收缩:否则 expand/collapse 的 setBounds 和拖拽的
  // setPosition 互相打架,dragEnd 时 collapse 还会把球拉回拖拽前位置("飞来飞去")
  if (drag) return Promise.resolve(computeAnchor())
  return new Promise((resolve) => {
    pendingResolvers.push(resolve)
    if (expandTimer) clearTimeout(expandTimer)
    expandTimer = setTimeout(() => {
      expandTimer = null
      applyExpanded(next)
      const anchor = computeAnchor()
      const resolvers = pendingResolvers
      pendingResolvers = []
      for (const r of resolvers) r(anchor)
    }, next ? EXPAND_DEBOUNCE_MS : COLLAPSE_DEBOUNCE_MS)
  })
}

function showContextMenu(): void {
  const win = floatWindow
  if (!win) return
  const menu = Menu.buildFromTemplate([
    {
      label: 'Refresh',
      click: () => {
        win.webContents.send('ccusage:refreshing')
        void refreshUsage()
      }
    },
    { label: 'Open Dashboard', click: () => callbacks?.openMainWindow() },
    { type: 'separator' },
    { label: 'Hide Ball', click: () => setFloatEnabled(false) }
  ])
  menuOpen = true
  menu.once('menu-will-close', () => {
    menuOpen = false
  })
  menu.popup({ window: win })
}

function registerFloatIpc(): void {
  ipcMain.handle('float:setExpanded', (_event, next: boolean) => handleSetExpanded(Boolean(next)))
  ipcMain.handle('float:getState', (): FloatState => ({ enabled: persist.enabled }))
  ipcMain.handle('float:setEnabled', (_event, enabled: boolean) => {
    setFloatEnabled(Boolean(enabled))
  })
  ipcMain.handle('float:getConfig', (): FloatConfig => currentConfig())
  ipcMain.handle('float:updateConfig', (_event, partial: Partial<FloatConfig>) =>
    updateFloatConfig(partial ?? {})
  )

  ipcMain.on('float:dragStart', (_event, screenX: number, screenY: number) => {
    const win = floatWindow
    const sx = toFiniteInt(screenX)
    const sy = toFiniteInt(screenY)
    if (!win || sx === null || sy === null) return
    // 展开态拖拽先收回,位置以折叠态锚点为准
    if (expanded) applyExpanded(false)
    const bounds = win.getBounds()
    drag = { startScreenX: sx, startScreenY: sy, startWinX: bounds.x, startWinY: bounds.y, moved: false }
  })
  ipcMain.on('float:dragMove', (_event, screenX: number, screenY: number) => {
    const sx = toFiniteInt(screenX)
    const sy = toFiniteInt(screenY)
    if (!drag || !floatWindow || sx === null || sy === null) return
    const dx = sx - drag.startScreenX
    const dy = sy - drag.startScreenY
    if (Math.hypot(dx, dy) >= CLICK_TOLERANCE_PX) drag.moved = true
    dlog('dragMove raw', screenX, screenY, '-> move to', drag.startWinX + dx, drag.startWinY + dy)
    // 必须用 setBounds 显式带尺寸:在非 100% DPI 屏幕上裸 setPosition
    // 每次调用会让窗口宽度泄漏 +1 DIP(Electron/Windows 物理像素取整缺陷)
    const size = collapsedSize()
    floatWindow.setBounds({
      x: drag.startWinX + dx,
      y: drag.startWinY + dy,
      width: size,
      height: size
    })
  })
  ipcMain.on('float:dragEnd', () => {
    if (!drag) return
    const wasClick = !drag.moved
    drag = null
    if (floatWindow && !expanded) {
      const bounds = floatWindow.getBounds()
      persist.x = bounds.x
      persist.y = bounds.y
      savePersist()
    }
    if (wasClick) callbacks?.openMainWindow()
  })
  ipcMain.on('float:openMain', () => callbacks?.openMainWindow())
  ipcMain.on('float:showMenu', () => showContextMenu())
}
