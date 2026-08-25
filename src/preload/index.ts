import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DetectResult, RefreshResult, SessionsResult, UsageSnapshot } from '../shared/usage-model'
import type { FloatAnchor, FloatState } from '../main/float'
import type { QuotaAccount, QuotaAccountConfigView, QuotaProviderId, QuotaSnapshot, RoundsView } from '../main/quota/types'
import type { FloatConfig } from '../shared/float-config'

const api = {
  detect: (): Promise<DetectResult> => ipcRenderer.invoke('ccusage:detect'),
  refresh: (): Promise<RefreshResult> => ipcRenderer.invoke('ccusage:refresh'),
  /** 取主进程缓存的快照(不触发刷新),悬浮球等被动窗口用 */
  getSnapshot: (): Promise<UsageSnapshot | null> => ipcRenderer.invoke('ccusage:snapshot'),
  /** 按需加载 session 维度(单次 ccusage 调用可能 1-2 分钟);失败时 report 为主进程缓存 */
  getSessions: (): Promise<SessionsResult> => ipcRenderer.invoke('usage:sessions'),
  /** 托盘等主进程侧触发的刷新完成后广播;返回取消订阅函数 */
  onRefreshed: (callback: (result: RefreshResult) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, result: RefreshResult): void => callback(result)
    ipcRenderer.on('ccusage:refreshed', listener)
    return () => ipcRenderer.removeListener('ccusage:refreshed', listener)
  },
  /** 主进程侧开始刷新时广播(悬浮球右键 Refresh);返回取消订阅函数 */
  onRefreshing: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ccusage:refreshing', listener)
    return () => ipcRenderer.removeListener('ccusage:refreshing', listener)
  },

  // ---- quota(订阅额度) ----
  /** 取主进程缓存的 quota 快照(不触发采集) */
  quotaGet: (): Promise<QuotaSnapshot | null> => ipcRenderer.invoke('quota:get'),
  quotaRefresh: (): Promise<QuotaSnapshot> => ipcRenderer.invoke('quota:refresh'),
  /** 主进程轮询/手动采集完成后广播;返回取消订阅函数 */
  onQuotaUpdated: (callback: (snapshot: QuotaSnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: QuotaSnapshot): void => callback(snapshot)
    ipcRenderer.on('quota:updated', listener)
    return () => ipcRenderer.removeListener('quota:updated', listener)
  },
  /** 轮次用量(当前轮/上一轮/历史);主进程状态机变化时推送 */
  quotaGetRounds: (): Promise<RoundsView> => ipcRenderer.invoke('quota:getRounds'),
  quotaOnRoundsUpdated: (callback: (view: RoundsView) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, view: RoundsView): void => callback(view)
    ipcRenderer.on('quota:rounds-updated', listener)
    return () => ipcRenderer.removeListener('quota:rounds-updated', listener)
  },
  /** 账号配置视图(不含 token) */
  quotaGetConfig: (): Promise<QuotaAccountConfigView[]> => ipcRenderer.invoke('quota:getConfig'),
  quotaSetEnabled: (accountId: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('quota:setEnabled', accountId, enabled),
  /** 新增 manual 账号;token 验证失败会以 Error 拒绝 */
  quotaAddAccount: (provider: QuotaProviderId, label: string, token: string): Promise<QuotaAccount> =>
    ipcRenderer.invoke('quota:addAccount', provider, label, token),
  quotaRemoveAccount: (accountId: string): Promise<void> =>
    ipcRenderer.invoke('quota:removeAccount', accountId),

  // ---- 悬浮球 ----
  /** 通知展开/折叠,main 防抖并调整窗口;resolve 时携带球在窗口内的锚角 */
  floatSetExpanded: (expanded: boolean): Promise<FloatAnchor> =>
    ipcRenderer.invoke('float:setExpanded', expanded),
  floatDragStart: (screenX: number, screenY: number): void =>
    ipcRenderer.send('float:dragStart', screenX, screenY),
  floatDragMove: (screenX: number, screenY: number): void =>
    ipcRenderer.send('float:dragMove', screenX, screenY),
  floatDragEnd: (screenX: number, screenY: number): void =>
    ipcRenderer.send('float:dragEnd', screenX, screenY),
  floatOpenMain: (): void => ipcRenderer.send('float:openMain'),
  floatShowMenu: (): void => ipcRenderer.send('float:showMenu'),
  floatGetState: (): Promise<FloatState> => ipcRenderer.invoke('float:getState'),
  floatSetEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('float:setEnabled', enabled),
  /** 悬浮球外观配置(大小/透明度/动画/配色) */
  floatGetConfig: (): Promise<FloatConfig> => ipcRenderer.invoke('float:getConfig'),
  floatUpdateConfig: (partial: Partial<FloatConfig>): Promise<FloatConfig> =>
    ipcRenderer.invoke('float:updateConfig', partial),
  /** main 侧配置变更推送(updateConfig 后);返回取消订阅函数 */
  onFloatConfig: (callback: (config: FloatConfig) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, config: FloatConfig): void => callback(config)
    ipcRenderer.on('float:config', listener)
    return () => ipcRenderer.removeListener('float:config', listener)
  },

  // ---- 系统(开机自启动) ----
  /** 是否随 Windows 登录自启动(注册表 Run 键) */
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('app:getAutoLaunch'),
  setAutoLaunch: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('app:setAutoLaunch', enabled),

  // ---- 无边框窗口 ----
  /** caption 按钮(min/max/close)配色随皮肤同步 */
  setTitlebarOverlay: (color: string, symbolColor: string): Promise<void> =>
    ipcRenderer.invoke('app:setTitlebarOverlay', color, symbolColor),
  /** 主窗口手动拖拽(指针捕获,坐标用 screenX/screenY) */
  windowDragStart: (screenX: number, screenY: number): void =>
    ipcRenderer.send('app:windowDragStart', screenX, screenY),
  windowDragMove: (screenX: number, screenY: number): void =>
    ipcRenderer.send('app:windowDragMove', screenX, screenY),
  windowDragEnd: (): void => ipcRenderer.send('app:windowDragEnd'),
  /** 双击拖拽区:最大化/还原 */
  toggleMaximize: (): void => ipcRenderer.send('app:toggleMaximize')
}

export type UsageApi = typeof api

contextBridge.exposeInMainWorld('usageApi', api)
