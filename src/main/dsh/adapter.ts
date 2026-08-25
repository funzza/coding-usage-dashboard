import { rowsToDaily } from '../../shared/usage-model'
import type { DailyUsage, ModelUsage } from '../../shared/usage-model'
import type { UsageOrigin } from '../../shared/usage-model'
import type { DshDailyModelRow } from './reader'

export const DSH_AGENT = 'dsh'

/**
 * dsh 行归一化(语义已与官方 session_projcache tokenUsage.totals 29/29 会话对账):
 * - inputTokens 本身就是"未命中缓存的输入"(uncached),**不做减法**(与 zcode 相反)
 * - reasoning 不拆分,已含在 outputTokens 内
 * - 无 cache creation(DeepSeek 语义:miss 即写缓存,无独立 creation 计费)
 * - totalTokens = input + output + cacheRead
 * - 无 cost(projcache 有峰谷定价表,后续要展示金额时可自算)
 */
function toModel(row: DshDailyModelRow): ModelUsage {
  const input = Math.max(0, row.inputTokens)
  const output = Math.max(0, row.outputTokens)
  const cacheRead = Math.max(0, row.cacheReadTokens)
  return {
    model: row.model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: 0,
    totalTokens: input + output + cacheRead,
    totalCost: 0
  }
}

/** dsh 聚合行 → normalized DailyUsage[](agent 固定为 'dsh',origin 标注来源环境) */
export function adaptDshRows(rows: DshDailyModelRow[], origin?: UsageOrigin): DailyUsage[] {
  return rowsToDaily(rows, DSH_AGENT, (r) => r.day, toModel, origin)
}
