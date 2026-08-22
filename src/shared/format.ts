/** 大数字缩写:3434102 → 3.43M;完整整数由 UI tooltip 展示 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

export function formatCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 100) return `$${n.toFixed(0)}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

/** 17.2s / 340ms */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/** 2026-08-21 → 08-21(图表刻度用) */
export function shortDate(iso: string): string {
  return iso.slice(5)
}

/** 图表坐标轴用:最多一位小数并去掉 .0,避免刻度标签撞车(500.00M 出现两次) */
export function formatAxisTokens(n: number): string {
  const trim = (v: number): string => {
    const s = v.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (n >= 1e9) return `${trim(n / 1e9)}B`
  if (n >= 1e6) return `${trim(n / 1e6)}M`
  if (n >= 1e3) return `${trim(n / 1e3)}K`
  return String(n)
}

/** 重置倒计时:'in 2h 15m' / 'in 3d 4h';已过期或非法返回 null */
export function formatResetIn(iso: string | null, now: number): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'in <1m'
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}
