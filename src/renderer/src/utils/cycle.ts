import type { QuotaWindow } from '../../../main/quota/types'

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/**
 * 由窗口 key + resetsAt 推断当前额度周期的起点:
 * - weekly → 7 天;daily/Nd → N 天;5h/Nh → N 小时;Nm → N 分钟
 * - monthly / credits → 自然月(reset 日往前推一个月)
 * - unknown 等无法识别的 key → null(UI 不显示)
 * 起点晚于 now(周期尚未开始)也返回 null。
 *
 * 注意:usage 数据是日粒度,5h 这类短窗口的"本周期"实际只能落到今天。
 */
export function cycleStart(window: QuotaWindow, now: Date = new Date()): Date | null {
  if (!window.resetsAt) return null
  const reset = new Date(window.resetsAt)
  if (!Number.isFinite(reset.getTime())) return null
  const start = new Date(reset)
  const key = window.key
  if (key === 'weekly') {
    start.setDate(start.getDate() - 7)
  } else if (key === 'monthly' || key === 'credits') {
    start.setMonth(start.getMonth() - 1)
  } else if (key === 'daily') {
    start.setDate(start.getDate() - 1)
  } else {
    const m = /^(\d+)([dhm])$/.exec(key)
    if (!m) return null
    const n = Number(m[1])
    if (m[2] === 'd') start.setDate(start.getDate() - n)
    else if (m[2] === 'h') start.setTime(start.getTime() - n * HOUR_MS)
    else start.setTime(start.getTime() - n * MINUTE_MS)
  }
  return start.getTime() <= now.getTime() ? start : null
}
