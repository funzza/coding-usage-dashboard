import { rowsToDaily } from '../../shared/usage-model'
import type { DailyUsage, ModelUsage } from '../../shared/usage-model'
import type { QoderDailyModelRow } from './reader'

export const QODER_AGENT = 'qoder'

/**
 * Qoder 行归一化(语义已用真实库全量验证,1245/1245 条):
 * - prompt_tokens **包含** cached_tokens,减去得到"新鲜 input",避免与 cache 字段双算
 * - 无 cache creation / reasoning 字段(OpenAI 兼容语义),均计 0
 * - 库内无 cost 字段,totalCost 恒为 0
 */
function toModel(row: QoderDailyModelRow): ModelUsage {
  const cacheRead = Math.max(0, row.cachedTokens)
  const input = Math.max(0, row.promptTokens - cacheRead)
  const output = Math.max(0, row.completionTokens)
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

/** qoder 聚合行 → normalized DailyUsage[](agent 固定为 'qoder') */
export function adaptQoderRows(rows: QoderDailyModelRow[]): DailyUsage[] {
  return rowsToDaily(rows, QODER_AGENT, (r) => r.day, toModel)
}
