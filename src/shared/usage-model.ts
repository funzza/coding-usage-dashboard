/**
 * 应用的 Normalized Usage Model —— 所有数据源(ccusage/zcode/dsh/...)统一产出的契约,
 * 以及操作该模型的纯函数。renderer / preload / shared 只能依赖这里,
 * 不得感知任何数据源的原始 schema。
 *
 * 数据源原始 JSON/SQLite/JSONL 的类型留在各自模块(如 main/ccusage/types.ts)。
 */

// ---------- Normalized model ----------

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCost: number
}

export interface ModelUsage extends TokenUsage {
  model: string
}

/** 某模型在单个 agent 下的用量(Model 详情的交叉视图用) */
export interface ModelAgentShare extends TokenUsage {
  agent: string
}

/** 跨 agent 聚合后的模型用量 */
export interface ModelAggregate extends ModelUsage {
  agents: ModelAgentShare[]
}

export interface AgentUsage extends TokenUsage {
  agent: string
  models: ModelUsage[]
}

export interface DailyUsage extends TokenUsage {
  date: string
  agents: AgentUsage[]
}

export interface EngineInfo {
  version: string
  path: string
}

/**
 * 额外数据源(zcode/dsh 等 ccusage 未覆盖的 agent)的本次采集状态:
 * - ok: 正常读取并合并(可能 0 行,如新装)
 * - skipped: 检测到但本次未合并(格式/版本不符、读取失败),reason 给出原因
 * - absent: 本机未检测到该数据源
 * ccusage 将来覆盖同名 agent 时为 skipped + reason 'covered by ccusage'(防双算)。
 */
export interface SourceStatus {
  state: 'ok' | 'skipped' | 'absent'
  reason?: string
}

/** 额外数据源的采集结果:daily 为 normalized 数据(可能 null),status 描述本次状态 */
export interface SourceCollectResult {
  daily: DailyUsage[] | null
  status: SourceStatus
}

export interface UsageSnapshot {
  engine: EngineInfo
  generatedAt: string
  /** 本次 ccusage 调用耗时(毫秒),用于性能观测 */
  refreshDurationMs: number
  range: { from: string; to: string }
  totals: TokenUsage
  today: TokenUsage
  last7Days: TokenUsage
  last30Days: TokenUsage
  /** 全量 daily,按日期升序;UI 自行切片 */
  daily: DailyUsage[]
  /** 全周期按 agent 聚合,动态生成,无数据的 agent 不出现 */
  agents: AgentUsage[]
  /** 额外数据源状态(zcode/dsh 等),键为 agent 名;ccusage 本体状态走 detect/engine */
  sources: Record<string, SourceStatus>
}

/** 单个编码会话的用量;lastActivity 为 ISO 时间戳,缺失时为 null */
export interface SessionUsage extends TokenUsage {
  id: string
  agent: string
  lastActivity: string | null
  models: ModelUsage[]
}

export interface SessionReport {
  engine: EngineInfo
  generatedAt: string
  /** 本次 ccusage 调用耗时(毫秒),用于性能观测 */
  refreshDurationMs: number
  totals: TokenUsage
  /** 按 lastActivity 倒序(无时间的排最后) */
  sessions: SessionUsage[]
}

// ---------- IPC contracts ----------

export interface DetectResult {
  found: boolean
  path?: string
  version?: string
}

export type RefreshResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; error: string; snapshot: UsageSnapshot | null }

export type SessionsResult =
  | { ok: true; report: SessionReport }
  | { ok: false; error: string; report: SessionReport | null }

// ---------- 纯函数 ----------

export function zeroUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0
  }
}

export function addUsage(acc: TokenUsage, add: TokenUsage): TokenUsage {
  acc.inputTokens += add.inputTokens
  acc.outputTokens += add.outputTokens
  acc.cacheReadTokens += add.cacheReadTokens
  acc.cacheCreationTokens += add.cacheCreationTokens
  acc.totalTokens += add.totalTokens
  acc.totalCost += add.totalCost
  return acc
}

/** 本地时区 YYYY-MM-DD */
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysAgo(now: Date, n: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return localDateString(d)
}

/** 合并已规范化的 AgentUsage */
export function mergeNormalizedAgent(agents: Map<string, AgentUsage>, incoming: AgentUsage): void {
  const existing = agents.get(incoming.agent)
  if (!existing) {
    agents.set(incoming.agent, { ...incoming, models: incoming.models.map((m) => ({ ...m })) })
    return
  }
  addUsage(existing, incoming)
  const models = new Map(existing.models.map((m) => [m.model, m]))
  for (const m of incoming.models) {
    const existingModel = models.get(m.model)
    if (existingModel) {
      addUsage(existingModel, m)
    } else {
      models.set(m.model, { ...m })
    }
  }
  existing.models = [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

/** 从全量 daily 重算 snapshot 的所有汇总字段(totals/today/7d/30d/agents/range) */
export function summarizeDaily(
  daily: DailyUsage[],
  now: Date
): Pick<UsageSnapshot, 'totals' | 'today' | 'last7Days' | 'last30Days' | 'agents' | 'range'> {
  const totals = zeroUsage()
  const agents = new Map<string, AgentUsage>()
  for (const day of daily) {
    addUsage(totals, day)
    for (const a of day.agents) {
      mergeNormalizedAgent(agents, a)
    }
  }

  const todayStr = localDateString(now)
  const since7 = daysAgo(now, 6)
  const since30 = daysAgo(now, 29)
  const today = zeroUsage()
  const last7Days = zeroUsage()
  const last30Days = zeroUsage()
  for (const day of daily) {
    if (day.date === todayStr) addUsage(today, day)
    if (day.date >= since7 && day.date <= todayStr) addUsage(last7Days, day)
    if (day.date >= since30 && day.date <= todayStr) addUsage(last30Days, day)
  }

  return {
    totals,
    today,
    last7Days,
    last30Days,
    agents: [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    range: {
      from: daily[0]?.date ?? todayStr,
      to: daily[daily.length - 1]?.date ?? todayStr
    }
  }
}

/**
 * 把额外数据源(zcode/dsh 等)的 normalized daily 合并进 snapshot,并重算全部汇总。
 * 调用方负责去重:ccusage 已含同名 agent 时不要合并(防止将来双算)。
 */
export function mergeDailyIntoSnapshot(
  snapshot: UsageSnapshot,
  extra: DailyUsage[],
  now: Date = new Date()
): void {
  if (extra.length === 0) return
  const byDate = new Map(snapshot.daily.map((d) => [d.date, d]))
  for (const day of extra) {
    const existing = byDate.get(day.date)
    if (!existing) {
      byDate.set(day.date, day)
      continue
    }
    addUsage(existing, day)
    const agents = new Map(existing.agents.map((a) => [a.agent, a]))
    for (const a of day.agents) {
      mergeNormalizedAgent(agents, a)
    }
    existing.agents = [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }
  const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  snapshot.daily = daily
  Object.assign(snapshot, summarizeDaily(daily, now))
}

/**
 * 额外数据源通用骨架:日×模型聚合行 → normalized DailyUsage[](单 agent)。
 * 各 adapter 只需提供行归一化(toModel),分组/合并/排序统一在这里。
 */
export function rowsToDaily<R>(
  rows: R[],
  agent: string,
  dayOf: (row: R) => string,
  toModel: (row: R) => ModelUsage
): DailyUsage[] {
  const byDay = new Map<string, DailyUsage>()
  for (const row of rows) {
    const date = dayOf(row)
    let day = byDay.get(date)
    if (!day) {
      day = { date, ...zeroUsage(), agents: [] }
      byDay.set(date, day)
    }
    const model = toModel(row)
    const agentUsage: AgentUsage = {
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cacheReadTokens: model.cacheReadTokens,
      cacheCreationTokens: model.cacheCreationTokens,
      totalTokens: model.totalTokens,
      totalCost: model.totalCost,
      agent,
      models: [model]
    }
    addUsage(day, agentUsage)
    const agents = new Map(day.agents.map((a) => [a.agent, a]))
    mergeNormalizedAgent(agents, agentUsage)
    day.agents = [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
