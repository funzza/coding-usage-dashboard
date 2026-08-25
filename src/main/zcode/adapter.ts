import { rowsToDaily } from '../../shared/usage-model'
import type { DailyUsage, ModelUsage } from '../../shared/usage-model'
import type { UsageOrigin } from '../../shared/usage-model'
import type { ZcodeDailyModelRow } from './reader'

export const ZCODE_AGENT = 'zcode'

/**
 * zcode 行归一化(语义已用真实库验证):
 * - zcode 的 input_tokens 包含 cache_read/cache_creation(computed_total = input + output),
 *   减去缓存部分得到"新鲜 input",避免与 cache 字段双算
 * - reasoning_tokens 计入 output(ccusage 对 reasoning 也归入 output 口径)
 * - totalTokens = 四项之和 ≈ computed_total + reasoning
 * - zcode 库无 cost 字段,totalCost 恒为 0(官方定价表后续可补)
 */
function toModel(row: ZcodeDailyModelRow): ModelUsage {
  const cacheRead = Math.max(0, row.cacheReadTokens)
  const cacheCreate = Math.max(0, row.cacheCreationTokens)
  const input = Math.max(0, row.inputTokens - cacheRead - cacheCreate)
  const output = Math.max(0, row.outputTokens) + Math.max(0, row.reasoningTokens)
  return {
    model: row.model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    totalTokens: input + output + cacheRead + cacheCreate,
    totalCost: 0
  }
}

/** zcode 聚合行 → normalized DailyUsage[](agent 固定为 'zcode',origin 标注来源环境) */
export function adaptZcodeRows(rows: ZcodeDailyModelRow[], origin?: UsageOrigin): DailyUsage[] {
  return rowsToDaily(rows, ZCODE_AGENT, (r) => r.day, toModel, origin)
}
