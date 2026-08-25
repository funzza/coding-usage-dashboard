import { defineStore } from 'pinia'
import type { SessionReport } from '../../../shared/usage-model'

/**
 * Sessions 数据(`ccusage session --json --by-agent`,单次调用可能 1-2 分钟)。
 * 按需触发 + 5 分钟 TTL 缓存 + 防并发;Overview(Today 活动图)与 Sessions 页共享,
 * 绝不随 App 启动加载,也不进 usage 的自动刷新。
 */
const TTL_MS = 5 * 60 * 1000

interface SessionsState {
  report: SessionReport | null
  fetchedAt: number | null
  loading: boolean
  error: string | null
}

export const useSessionsStore = defineStore('sessions', {
  state: (): SessionsState => ({
    report: null,
    fetchedAt: null,
    loading: false,
    error: null
  }),

  actions: {
    /** 缓存新鲜则直接返回;force 强制刷新(手动 Refresh 按钮) */
    async ensure(force = false): Promise<void> {
      if (this.loading) return
      if (!force && this.report && this.fetchedAt && Date.now() - this.fetchedAt < TTL_MS) return
      this.loading = true
      this.error = null
      try {
        const result = await window.usageApi.getSessions()
        // 失败也保留主进程返回的缓存数据,只展示错误
        if (result.report) {
          this.report = result.report
          this.fetchedAt = Date.now()
        }
        if (!result.ok) this.error = result.error
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.loading = false
      }
    }
  }
})
