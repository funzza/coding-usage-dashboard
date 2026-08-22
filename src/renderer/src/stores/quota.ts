import { defineStore } from 'pinia'
import type { QuotaAccount, QuotaSnapshot } from '../../../main/quota/types'

/**
 * quota 快照的消费端:轮询只在主进程,两个窗口都只是取缓存 + 订阅广播,
 * renderer 永远不直接接触凭据或采集逻辑。
 */
interface QuotaState {
  snapshot: QuotaSnapshot | null
  refreshing: boolean
  unsubscribe: (() => void) | null
}

export const useQuotaStore = defineStore('quota', {
  state: (): QuotaState => ({
    snapshot: null,
    refreshing: false,
    unsubscribe: null
  }),

  getters: {
    /** 有凭据的账号(ok / error 都算;未检测到的不出现在 Overview) */
    activeAccounts: (state): QuotaAccount[] =>
      state.snapshot?.accounts.filter((a) => a.status !== 'unavailable') ?? []
  },

  actions: {
    /** 主窗口与悬浮球共用:被动初始化,绝不触发轮询 */
    async init(): Promise<void> {
      if (!this.unsubscribe) {
        this.unsubscribe = window.usageApi.onQuotaUpdated((snapshot) => {
          this.snapshot = snapshot
          this.refreshing = false
        })
      }
      this.snapshot = await window.usageApi.quotaGet()
    },

    /** 手动刷新 quota(独立于 ccusage 刷新,秒级完成) */
    async refresh(): Promise<void> {
      if (this.refreshing) return
      this.refreshing = true
      try {
        this.snapshot = await window.usageApi.quotaRefresh()
      } finally {
        this.refreshing = false
      }
    }
  }
})
