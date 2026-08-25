import { defineStore } from 'pinia'
import type { DetectResult, RefreshResult, UsageSnapshot } from '../../../shared/usage-model'
import type { OriginFilter, RangeKey } from '../../../shared/analytics'

export type StoreStatus = 'detecting' | 'setup' | 'loading' | 'ready' | 'error'

/**
 * 单次 ccusage 调用约 17s,自动刷新必须低频:
 * 每 5 分钟一次,且仅在已有数据时触发;手动刷新随时可用。
 * 主进程有 in-flight 守卫,这里再防一次重入。
 */
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000

interface UsageState {
  detect: DetectResult | null
  snapshot: UsageSnapshot | null
  status: StoreStatus
  refreshing: boolean
  error: string
  /** 全局时间范围,驱动所有页面的数字与图表 */
  range: RangeKey
  /** 全局分析维度:侧栏 Today 速览 + Overview 趋势/donut/drift/明细统一受控,默认 model 视角 */
  dimension: 'agents' | 'models'
  /** 全局数据来源环境筛选:只看 Windows / 只看 WSL / 全部;影响 Overview、Sessions 与侧栏 */
  origin: OriginFilter
  autoRefreshTimer: ReturnType<typeof setInterval> | null
  unsubscribeRefreshed: (() => void) | null
  unsubscribeRefreshing: (() => void) | null
}

export const useUsageStore = defineStore('usage', {
  state: (): UsageState => ({
    detect: null,
    snapshot: null,
    status: 'detecting',
    refreshing: false,
    error: '',
    range: 'today',
    dimension: 'models',
    origin: 'all',
    autoRefreshTimer: null,
    unsubscribeRefreshed: null,
    unsubscribeRefreshing: null
  }),

  getters: {
    agents: (state) => state.snapshot?.agents ?? [],
    lastUpdatedAt: (state) => (state.snapshot ? new Date(state.snapshot.generatedAt) : null)
  },

  actions: {
    async init(): Promise<void> {
      // 托盘等主进程侧触发的刷新结果直接应用,保持 UI 同步
      this.unsubscribeRefreshed = window.usageApi.onRefreshed((result) => this.applyResult(result))

      this.status = 'detecting'
      this.detect = await window.usageApi.detect()
      if (!this.detect.found) {
        this.status = 'setup'
        return
      }
      this.status = 'loading'
      await this.refresh()
      this.startAutoRefresh()
    },

    /**
     * 悬浮球等被动窗口:只订阅广播 + 拉取缓存快照填充 state,
     * 绝不触发 refresh、不启动自动刷新定时器(避免两个窗口各自 spawn ccusage)
     */
    async initPassive(): Promise<void> {
      this.unsubscribeRefreshed = window.usageApi.onRefreshed((result) => this.applyResult(result))
      this.unsubscribeRefreshing = window.usageApi.onRefreshing(() => {
        this.refreshing = true
      })

      this.detect = await window.usageApi.detect()
      if (!this.detect.found) {
        this.status = 'setup'
        return
      }
      // 主窗口可能还在首次刷新中:没有缓存就先显示空态,等 onRefreshed 广播
      this.snapshot = await window.usageApi.getSnapshot()
      this.status = 'ready'
    },

    /** 手动刷新;进行中重复调用直接忽略(主进程同样串行化) */
    async refresh(): Promise<void> {
      if (this.refreshing) return
      this.refreshing = true
      try {
        this.applyResult(await window.usageApi.refresh())
      } finally {
        this.refreshing = false
      }
    },

    /** Setup 页 Recheck:重新探测,成功后立刻刷新 */
    async redetect(): Promise<void> {
      this.status = 'detecting'
      this.error = ''
      this.detect = await window.usageApi.detect()
      if (!this.detect.found) {
        this.status = 'setup'
        return
      }
      this.status = 'loading'
      await this.refresh()
      this.startAutoRefresh()
    },

    applyResult(result: RefreshResult): void {
      // 广播路径(托盘/悬浮球触发的刷新)也在这里收尾
      this.refreshing = false
      if (result.ok) {
        this.snapshot = result.snapshot
        this.error = ''
        this.status = 'ready'
        return
      }
      this.error = result.error
      if (result.snapshot) {
        // 失败但保留了最近一次成功数据
        this.snapshot = result.snapshot
        this.status = 'ready'
      } else if (!this.snapshot) {
        this.status = 'error'
      }
    },

    startAutoRefresh(): void {
      if (this.autoRefreshTimer) return
      this.autoRefreshTimer = setInterval(() => {
        if (!this.refreshing && this.snapshot) {
          void this.refresh()
        }
      }, AUTO_REFRESH_INTERVAL_MS)
    }
  }
})
