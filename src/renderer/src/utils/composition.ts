import type { TokenUsage } from '../../../shared/usage-model'
import { cacheReadShare } from '../../../shared/analytics'
import { formatTokens } from '../../../shared/format'

/** Token composition 四段的统一配色与标签;color 是兜底值,token 是对应 CSS 变量(随皮肤切换) */
export const COMPOSITION_SEGMENTS = [
  { key: 'input', label: 'Input', color: '#5B8FF9', token: '--comp-input' },
  { key: 'output', label: 'Output', color: '#5AD8A6', token: '--comp-output' },
  { key: 'cacheRead', label: 'Cache Read', color: '#9270CA', token: '--comp-cache-read' },
  { key: 'cacheCreation', label: 'Cache Creation', color: '#F6BD16', token: '--comp-cache-creation' }
] as const

/**
 * hover 提示:每段真实数字 + 占总量的构成比(CompositionBar / 明细行共用);无数据返回空串。
 * 末尾单独附 Cached Input Share(缓存读 ÷ 输入侧总量)——构成比的分母是 total(含 output),
 * 与明细 CACHED 列口径不同,并列展示避免两个相近数字互相混淆。
 */
export function compositionTooltip(usage: TokenUsage): string {
  const parts = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
  if (parts <= 0) return ''
  const lines = COMPOSITION_SEGMENTS.map((s) => {
    const value = usage[`${s.key}Tokens`]
    return value > 0 ? `${s.label}  ${formatTokens(value)} (${((value / parts) * 100).toFixed(1)}%)` : null
  }).filter(Boolean) as string[]
  if (usage.inputTokens + usage.cacheReadTokens > 0) {
    lines.push(`Cached Input Share  ${(cacheReadShare(usage) * 100).toFixed(1)}% (of input)`)
  }
  return lines.join('\n')
}

/** 排行/占比类图表(ShareDonut 等)的单条目 */
export interface RankItem {
  name: string
  color: string
  usage: TokenUsage
}

/** Other 汇总条目的固定色(与 DailyBarChart 堆叠的 Other 一致) */
export const OTHER_COLOR = '#3a4356'

/** 条目截断 top N,剩余合计为一条 Other;调用方需已按 totalTokens 降序 */
export function topWithOther(items: RankItem[], limit = 10): RankItem[] {
  if (items.length <= limit) return items
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0
  }
  for (const it of items.slice(limit)) {
    usage.inputTokens += it.usage.inputTokens
    usage.outputTokens += it.usage.outputTokens
    usage.cacheReadTokens += it.usage.cacheReadTokens
    usage.cacheCreationTokens += it.usage.cacheCreationTokens
    usage.totalTokens += it.usage.totalTokens
    usage.totalCost += it.usage.totalCost
  }
  return [...items.slice(0, limit), { name: 'Other', color: OTHER_COLOR, usage }]
}
