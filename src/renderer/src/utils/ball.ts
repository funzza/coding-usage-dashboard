import { usageMilestones, usageTier, type UsageTier } from '../../../shared/analytics'
import type { UsageSnapshot } from '../../../shared/usage-model'
import type { QuotaAccount } from '../../../main/quota/types'
import type { FloatColorMode } from '../../../shared/float-config'

/**
 * 由快照与配色模式推导球体展示参数(FloatBall 与 Settings 预览共用):
 * - 历史 = daily 中 date < 今天的所有天(daily 按日期升序,最后一天即今天)
 * - 固定品牌色模式不分档;无历史同样兜品牌色
 * - 填充比例 = 今日总量 / P90,封顶 100%;无历史或 P90 为 0 时给满环
 */
export function resolveBallVisual(
  snapshot: UsageSnapshot | null,
  colorMode: FloatColorMode
): { tier: UsageTier; fillRatio: number } {
  const daily = snapshot?.daily ?? []
  const todayDate = daily[daily.length - 1]?.date ?? ''
  const todayTotal = snapshot?.today.totalTokens ?? 0
  const milestones = usageMilestones(daily, todayDate)
  const tier = colorMode === 'fixed' ? 'brand' : usageTier(todayTotal, milestones)
  const fillRatio =
    milestones && milestones.p90 > 0 ? Math.min(1, todayTotal / milestones.p90) : 1
  return { tier, fillRatio }
}

// ---------- quota 警示(悬浮球外显 + 悬停面板行高亮共用) ----------

/** 警示阈值(模块内常量,不进设置):≥90% 琥珀,≥98% 红 */
export const QUOTA_WARN_PERCENT = 90
export const QUOTA_CRITICAL_PERCENT = 98

export type QuotaAlarmLevel = 'warn' | 'critical'

/** 警示配色:球体呼吸点与悬停面板高亮同色 */
export const QUOTA_ALARM_COLORS: Record<QuotaAlarmLevel, string> = {
  warn: '#f6bd16',
  critical: '#f87171'
}

export interface QuotaAlarm {
  level: QuotaAlarmLevel
  accountId: string
  windowLabel: string
  usedPercent: number
}

/** 单窗口用量是否达到警示档 */
export function quotaAlarmLevel(usedPercent: number): QuotaAlarmLevel | null {
  if (usedPercent >= QUOTA_CRITICAL_PERCENT) return 'critical'
  if (usedPercent >= QUOTA_WARN_PERCENT) return 'warn'
  return null
}

/**
 * 悬浮球 quota 警示:扫所有账号的所有窗口,取用量百分比最高者;
 * 达阈值返回警示,否则 null。
 * 调用方传 activeAccounts:快照在主进程只采集 enabled 账号,
 * unavailable(未检测到凭据)无数据可警示,由 getter 滤掉。
 */
export function resolveQuotaAlarm(accounts: QuotaAccount[]): QuotaAlarm | null {
  let worst: QuotaAlarm | null = null
  for (const account of accounts) {
    for (const w of account.windows) {
      const level = quotaAlarmLevel(w.usedPercent)
      if (level && w.usedPercent > (worst?.usedPercent ?? -1)) {
        worst = {
          level,
          accountId: account.accountId,
          windowLabel: w.label,
          usedPercent: w.usedPercent
        }
      }
    }
  }
  return worst
}
