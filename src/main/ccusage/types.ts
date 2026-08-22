/**
 * ccusage 原始 JSON 类型(基于本机 ccusage 20.0.20 的
 * `ccusage daily --json --by-agent` 真实输出,见 fixtures/ccusage-daily-by-agent.json)。
 *
 * 字段全部视为可选:ccusage 上游 schema 变化时,适配逻辑集中在 adapter.ts,
 * 缺失字段按 0 处理,不抛异常。
 *
 * 应用内部的 Normalized Model 与 IPC 契约在 src/shared/usage-model.ts。
 */

export interface CcusageModelBreakdown {
  modelName?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  cost?: number
}

export interface CcusageAgentBreakdown {
  agent?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  totalTokens?: number
  totalCost?: number
  modelsUsed?: string[]
  modelBreakdowns?: CcusageModelBreakdown[]
}

export interface CcusageDailyRow extends CcusageAgentBreakdown {
  period?: string
  /** --by-agent 时存在:当天各 agent 的明细 */
  agents?: CcusageAgentBreakdown[]
}

export interface CcusageDailyReport {
  daily?: CcusageDailyRow[]
  totals?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    totalTokens?: number
    totalCost?: number
  }
}

/**
 * ccusage `session --json --by-agent` 原始 schema
 * (基于本机 20.0.20 真实输出,见 fixtures/ccusage-session-by-agent.json)。
 * 每个 session 只属于一个 agent,行上直接带 agent 字段,无嵌套 agents。
 */
export interface CcusageSessionRow extends CcusageAgentBreakdown {
  /** session ID(通常是 UUID) */
  period?: string
  metadata?: {
    /** ISO 时间戳,部分行缺失 */
    lastActivity?: string
    reasoningOutputTokens?: number
    projectPath?: string
  }
}

export interface CcusageSessionReport {
  session?: CcusageSessionRow[]
  totals?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    totalTokens?: number
    totalCost?: number
  }
}
