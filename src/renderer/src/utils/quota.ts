import type { QuotaAccount, QuotaWindow } from '../../../main/quota/types'
import { activeSkinId } from './skin'

/**
 * quota 进度条配色(QuotaCard / QuotaStrip 共用):
 * classic 维持 60/85 分档语义色;其余皮肤统一用 token(中性填充,打满 >=100% 用红)。
 */
export function quotaBarColor(percent: number, baseColor: string): string {
  // touch 皮肤状态,保证换肤后重算
  void activeSkinId.value
  if (activeSkinId.value !== 'classic') {
    return percent >= 100 ? 'var(--red)' : 'var(--quota-fill)'
  }
  if (percent >= 85) return '#f87171'
  if (percent >= 60) return '#F6BD16'
  return baseColor
}

/**
 * 窗口周期排序:值越小周期越短。
 * credits(余额兜底)/unknown 不是时间窗,排最后。
 */
const PERIOD_ORDER: Record<string, number> = {
  '5h': 0,
  '1d': 1,
  daily: 1,
  '3d': 2,
  weekly: 3,
  monthly: 4
}

function periodRank(w: QuotaWindow): number {
  return PERIOD_ORDER[w.key] ?? 99
}

/**
 * strip 缩略显示的窗口:周期最短者(Kimi/OpenCode Go → 5h,ChatGPT/Grok → Weekly)。
 * 缩略语义是"最小限制周期"的用量,而非最紧急;紧急度见 accountUrgency。
 */
export function displayWindow(account: QuotaAccount): QuotaWindow | null {
  if (account.windows.length === 0) return null
  return account.windows.reduce((a, b) => (periodRank(b) < periodRank(a) ? b : a))
}

/** 账号紧急度 = 所有窗口的最高用量;strip 排序用(最紧急的账号排最前) */
export function accountUrgency(account: QuotaAccount): number {
  return account.windows.reduce((max, w) => Math.max(max, w.usedPercent), 0)
}
