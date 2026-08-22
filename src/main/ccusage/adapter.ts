import { addUsage, mergeNormalizedAgent, summarizeDaily, zeroUsage } from '../../shared/usage-model'
import type {
  AgentUsage,
  DailyUsage,
  EngineInfo,
  ModelUsage,
  SessionReport,
  SessionUsage,
  TokenUsage,
  UsageSnapshot
} from '../../shared/usage-model'
import type {
  CcusageAgentBreakdown,
  CcusageDailyReport,
  CcusageDailyRow,
  CcusageModelBreakdown,
  CcusageSessionReport,
  CcusageSessionRow
} from './types'

/**
 * ccusage raw JSON → Normalized Model 的唯一定点。
 * schema 兼容/容错全部集中在这里;normalized model 本身的操作(求和/合并/汇总)
 * 在 shared/usage-model.ts,数据源无关。
 */

function num(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * ccusage 报告的 totalTokens 与 input+output+cacheRead+cacheCreation 并不严格相等
 * (部分 harness 含 reasoning 等其他 token),优先采用上报值,缺失时回退为四项之和。
 */
function toUsage(raw: CcusageAgentBreakdown | undefined): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: num(raw?.inputTokens),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: num(raw?.cacheReadTokens),
    cacheCreationTokens: num(raw?.cacheCreationTokens),
    totalTokens: 0,
    totalCost: num(raw?.totalCost)
  }
  const parts = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
  usage.totalTokens = num(raw?.totalTokens) || parts
  return usage
}

function toModelUsage(raw: CcusageModelBreakdown): ModelUsage {
  return {
    model: raw.modelName ?? 'unknown',
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    cacheReadTokens: num(raw.cacheReadTokens),
    cacheCreationTokens: num(raw.cacheCreationTokens),
    totalTokens:
      num(raw.inputTokens) + num(raw.outputTokens) + num(raw.cacheReadTokens) + num(raw.cacheCreationTokens),
    totalCost: num(raw.cost)
  }
}

function mergeModel(models: Map<string, ModelUsage>, raw: CcusageModelBreakdown): void {
  const mu = toModelUsage(raw)
  const existing = models.get(mu.model)
  if (existing) {
    addUsage(existing, mu)
  } else {
    models.set(mu.model, mu)
  }
}

function toAgentUsage(raw: CcusageAgentBreakdown): AgentUsage {
  const usage = toUsage(raw)
  const models = new Map<string, ModelUsage>()
  for (const mb of raw.modelBreakdowns ?? []) {
    mergeModel(models, mb)
  }
  // 没有 modelBreakdowns 但有 modelsUsed 时,保留模型名(用量为 0)
  for (const name of raw.modelsUsed ?? []) {
    if (!models.has(name)) {
      models.set(name, { ...zeroUsage(), model: name })
    }
  }
  return {
    ...usage,
    agent: raw.agent ?? 'unknown',
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }
}

/** 合并 ccusage 原始 agent 行(daily[].agents[] 的元素) */
function mergeRawAgent(agents: Map<string, AgentUsage>, raw: CcusageAgentBreakdown): void {
  mergeNormalizedAgent(agents, toAgentUsage(raw))
}

function normalizeRow(row: CcusageDailyRow): DailyUsage | null {
  if (!row.period) return null
  const agents = new Map<string, AgentUsage>()
  for (const a of row.agents ?? []) {
    mergeRawAgent(agents, a)
  }
  return {
    date: row.period,
    ...toUsage(row),
    agents: [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }
}

/**
 * ccusage `daily --json --by-agent` → UsageSnapshot。
 * 额外数据源(zcode/dsh)的合并由 usage service 在此之后追加。
 */
export function adaptDailyReport(
  raw: unknown,
  engine: EngineInfo,
  now: Date = new Date(),
  refreshDurationMs = 0
): UsageSnapshot {
  const report = (raw ?? {}) as CcusageDailyReport
  const daily: DailyUsage[] = []
  for (const row of report.daily ?? []) {
    const normalized = normalizeRow(row)
    if (normalized) daily.push(normalized)
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return {
    engine,
    generatedAt: now.toISOString(),
    refreshDurationMs,
    daily,
    sources: {},
    ...summarizeDaily(daily, now)
  }
}

function toSessionUsage(raw: CcusageSessionRow): SessionUsage | null {
  if (!raw.period) return null
  const models = new Map<string, ModelUsage>()
  for (const mb of raw.modelBreakdowns ?? []) {
    mergeModel(models, mb)
  }
  for (const name of raw.modelsUsed ?? []) {
    if (!models.has(name)) {
      models.set(name, { ...zeroUsage(), model: name })
    }
  }
  const lastActivity = raw.metadata?.lastActivity
  return {
    ...toUsage(raw),
    id: raw.period,
    agent: raw.agent ?? 'unknown',
    lastActivity: typeof lastActivity === 'string' && lastActivity ? lastActivity : null,
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }
}

/**
 * ccusage `session --json --by-agent` → SessionReport。
 * 与 adaptDailyReport 同样的容错策略:缺失字段按 0 / null 处理,不抛异常。
 */
export function adaptSessionReport(
  raw: unknown,
  engine: EngineInfo,
  now: Date = new Date(),
  refreshDurationMs = 0
): SessionReport {
  const report = (raw ?? {}) as CcusageSessionReport
  const sessions: SessionUsage[] = []
  for (const row of report.session ?? []) {
    const normalized = toSessionUsage(row)
    if (normalized) sessions.push(normalized)
  }
  // 最近活动的 session 在前;无 lastActivity 的排最后(按 id 稳定次序)
  sessions.sort((a, b) => {
    if (a.lastActivity === b.lastActivity) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (!a.lastActivity) return 1
    if (!b.lastActivity) return -1
    return a.lastActivity < b.lastActivity ? 1 : -1
  })

  const totals = zeroUsage()
  for (const s of sessions) {
    addUsage(totals, s)
  }

  return {
    engine,
    generatedAt: now.toISOString(),
    refreshDurationMs,
    totals,
    sessions
  }
}
