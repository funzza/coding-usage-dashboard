/**
 * 纯函数分析层:所有 range 过滤 / 维度聚合 / 补零 / 派生指标的唯一实现。
 * main 与 renderer 共用;输入一律是 adapter 产出的 normalized model。
 * 不做任何 ccusage 调用,不接触原始 JSON。
 */
import { addUsage, localDateString, mergeNormalizedAgent, zeroUsage } from './usage-model'
import { agentKeyOf, parseAgentKey } from './agents'
import type { UsageOrigin } from './agents'
import { shortDate } from './format'
import type {
  AgentUsage,
  DailyUsage,
  ModelAggregate,
  ModelUsage,
  SessionUsage,
  TokenUsage
} from './usage-model'

export type RangeKey = 'today' | '7d' | '30d' | 'all'

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  '7d': 'Weekly',
  '30d': 'Monthly',
  all: 'All Time'
}

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** range 对应的本地日期区间;'all' 的 from 为 null(表示不过滤下限) */
export function rangeDates(range: RangeKey, now: Date = new Date()): { from: string | null; to: string } {
  const to = localDateString(now)
  if (range === 'all') return { from: null, to }
  const daysBack = range === 'today' ? 0 : range === '7d' ? 6 : 29
  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)
  return { from: localDateString(from), to }
}

/** 按 range 过滤 daily(不补零,聚合用这个) */
export function filterDailyByRange(
  daily: DailyUsage[],
  range: RangeKey,
  now: Date = new Date()
): DailyUsage[] {
  const { from, to } = rangeDates(range, now)
  return daily.filter((d) => d.date <= to && (from === null || d.date >= from))
}

/** 区间内缺失日期补零行(图表用,X 轴连续);返回按日期升序 */
export function fillMissingDays(daily: DailyUsage[], from: string, to: string): DailyUsage[] {
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const result: DailyUsage[] = []
  const cursor = parseLocalDate(from)
  const end = parseLocalDate(to)
  while (cursor <= end) {
    const iso = localDateString(cursor)
    result.push(byDate.get(iso) ?? { date: iso, ...zeroUsage(), agents: [] })
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

/** range 过滤 + 补零;'all' 从首个有数据的日期开始 */
export function selectRangeDaily(
  daily: DailyUsage[],
  range: RangeKey,
  now: Date = new Date()
): DailyUsage[] {
  const filtered = filterDailyByRange(daily, range, now)
  const { from, to } = rangeDates(range, now)
  const effectiveFrom = from ?? filtered[0]?.date ?? to
  return fillMissingDays(filtered, effectiveFrom, to)
}

export function sumDaily(daily: DailyUsage[]): TokenUsage {
  const total = zeroUsage()
  for (const day of daily) addUsage(total, day)
  return total
}

export type OriginFilter = 'all' | UsageOrigin

/**
 * 按 origin 过滤 daily(保留日期序列):'all' 原样返回;过滤时丢弃非目标 origin 的
 * agent,day 用量按保留 agent 重算(而非按比例摊)——口径为"只数该侧的量"。
 * 返回新数组,不 mutate 输入。
 */
export function filterByOrigin(daily: DailyUsage[], origin: OriginFilter): DailyUsage[] {
  if (origin === 'all') return daily
  return daily.map((day) => {
    const agents = day.agents.filter((a) => (a.origin ?? 'windows') === origin)
    if (agents.length === day.agents.length) return day
    const usage = zeroUsage()
    for (const a of agents) addUsage(usage, a)
    return { date: day.date, ...usage, agents }
  })
}

// ---------- 周/月聚合(趋势图粒度切换) ----------

export type BucketGranularity = 'day' | 'week' | 'month'

/** 日期所在 ISO 周(周一起)的周一,本地时区 YYYY-MM-DD */
export function isoWeekStart(iso: string): string {
  const d = parseLocalDate(iso)
  const dow = (d.getDay() + 6) % 7 // Sunday=6 → Monday=0
  d.setDate(d.getDate() - dow)
  return localDateString(d)
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

/** bucket 起始日的 X 轴标签:day `08-21`,week `8/17`(周一),month `Aug` */
export function bucketLabel(date: string, granularity: BucketGranularity): string {
  if (granularity === 'month') return MONTH_NAMES[Number(date.slice(5, 7)) - 1]
  if (granularity === 'week') return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
  return shortDate(date)
}

/**
 * 把 daily(升序)聚合为周/月 bucket;day 原样返回。
 * bucket 的 date = 起始日(周一 / 每月 1 日),TokenUsage 全字段求和,
 * agents/models 明细跨天合并,供图表按 agent/model 拆系列。
 */
export function bucketDaily(daily: DailyUsage[], granularity: BucketGranularity): DailyUsage[] {
  if (granularity === 'day') return daily
  const keyOf = granularity === 'week' ? isoWeekStart : (iso: string) => `${iso.slice(0, 7)}-01`
  const buckets = new Map<string, DailyUsage & { _agents: Map<string, AgentUsage> }>()
  for (const day of daily) {
    const key = keyOf(day.date)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { date: key, ...zeroUsage(), agents: [], _agents: new Map() }
      buckets.set(key, bucket)
    }
    addUsage(bucket, day)
    for (const a of day.agents) {
      mergeNormalizedAgent(bucket._agents, a)
    }
  }
  return [...buckets.values()].map(({ _agents, ...rest }) => ({
    ...rest,
    agents: [..._agents.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }))
}

/** 跨天聚合 agent 维度 */
export function aggregateAgents(daily: DailyUsage[]): AgentUsage[] {
  const agents = new Map<string, AgentUsage>()
  for (const day of daily) {
    for (const a of day.agents) {
      mergeNormalizedAgent(agents, a)
    }
  }
  return [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

/** 跨 agent 聚合 model 维度,并记录每个模型在各 agent 下的用量(Used By 按 agent×origin 分行) */
export function aggregateModels(daily: DailyUsage[]): ModelAggregate[] {
  const models = new Map<string, ModelAggregate & { _agents: Map<string, TokenUsage & { agent: string; origin?: UsageOrigin }> }>()
  for (const day of daily) {
    for (const agent of day.agents) {
      for (const m of agent.models) {
        let entry = models.get(m.model)
        if (!entry) {
          entry = { ...zeroUsage(), model: m.model, agents: [], _agents: new Map() }
          models.set(m.model, entry)
        }
        addUsage(entry, m)
        const key = agentKeyOf(agent)
        const share = entry._agents.get(key) ?? { ...zeroUsage(), agent: agent.agent, origin: agent.origin }
        addUsage(share, m)
        entry._agents.set(key, share)
      }
    }
  }
  return [...models.values()]
    .map(({ _agents, ...rest }) => ({
      ...rest,
      agents: [..._agents.entries()]
        .map(([, share]) => ({ ...share }))
        .sort((a, b) => b.totalTokens - a.totalTokens)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

/** 单个 agent(以 agentKey 标识,如 `kimi@wsl`)在给定 daily 内的 model 聚合 */
export function aggregateAgentModels(daily: DailyUsage[], agentKey: string): ModelUsage[] {
  const { agent: agentName, origin } = parseAgentKey(agentKey)
  const models = new Map<string, ModelUsage>()
  for (const day of daily) {
    const entry = day.agents.find((a) => a.agent === agentName && (a.origin ?? 'windows') === origin)
    if (!entry) continue
    for (const m of entry.models) {
      const existing = models.get(m.model)
      if (existing) {
        addUsage(existing, m)
      } else {
        models.set(m.model, { ...m })
      }
    }
  }
  return [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

/** 悬浮球用量自适应配色的档位 */
export type UsageTier = 'cool' | 'brand' | 'warm' | 'blazing'

/** 线性插值分位数:sorted[q*(n-1)] 处插值 */
function quantile(sorted: number[], q: number): number {
  const idx = q * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export interface Milestones {
  median: number
  p75: number
  p90: number
}

/** 任意日总量序列的分位里程碑(详情页按实体过滤后用);空序列返回 null */
export function milestonesOf(totals: number[]): Milestones | null {
  if (totals.length === 0) return null
  const sorted = [...totals].sort((a, b) => a - b)
  return { median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) }
}

/**
 * 历史日总量(date < today,含 0 值天,诚实反映"普通的一天")的分位里程碑;
 * 空历史(新用户)返回 null,调用方用品牌色兜底
 */
export function usageMilestones(daily: DailyUsage[], today: string): Milestones | null {
  return milestonesOf(daily.filter((d) => d.date < today).map((d) => d.totalTokens))
}

/** 今日总量落在哪个配色档;无历史时由调用方兜品牌色,这里同样返回 'brand' */
export function usageTier(todayTotal: number, milestones: Milestones | null): UsageTier {
  if (!milestones) return 'brand'
  if (todayTotal < milestones.median) return 'cool'
  if (todayTotal < milestones.p75) return 'brand'
  if (todayTotal < milestones.p90) return 'warm'
  return 'blazing'
}

/**
 * 输入侧由缓存读取提供的占比:cacheRead / (cacheRead + input)。
 * 这不是请求级"命中率"(ccusage 不提供请求级数据),UI 必须命名为 Cache Read Share。
 */
export function cacheReadShare(usage: TokenUsage): number {
  const denom = usage.cacheReadTokens + usage.inputTokens
  return denom > 0 ? usage.cacheReadTokens / denom : 0
}

/** 每日 × 模型的 totalTokens 矩阵(模型堆叠图用) */
export function modelTotalsByDay(daily: DailyUsage[]): Array<{ date: string; byModel: Map<string, number> }> {
  return daily.map((day) => {
    const byModel = new Map<string, number>()
    for (const agent of day.agents) {
      for (const m of agent.models) {
        byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.totalTokens)
      }
    }
    return { date: day.date, byModel }
  })
}

// ---------- 区间统计 / 节律 / 漂移 / 小时分布(Overview 重构新增) ----------

export interface RangeStats {
  /** 窗口覆盖天数:'all' 为实际数据跨度(无数据时为 1) */
  days: number
  /** totalTokens > 0 的天数 */
  activeDays: number
  avgPerDay: number
  busiestDay: { date: string; totalTokens: number } | null
  /** 与紧前等长窗口的总量环比 (cur - prev) / prev;prev 无数据/为 0 或 range='all' 时为 null */
  prevDelta: number | null
}

function dayDiff(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000)
}

/** 区间统计;输入为全量 daily(未过滤),内部自行切窗口 */
export function rangeStats(daily: DailyUsage[], range: RangeKey, now: Date = new Date()): RangeStats {
  const { from, to } = rangeDates(range, now)
  const current = filterDailyByRange(daily, range, now)
  const total = current.reduce((s, d) => s + d.totalTokens, 0)
  const activeDays = current.filter((d) => d.totalTokens > 0).length
  const days = from === null ? Math.max(1, dayDiff(current[0]?.date ?? to, to) + 1) : dayDiff(from, to) + 1

  let busiestDay: RangeStats['busiestDay'] = null
  for (const d of current) {
    if (d.totalTokens > 0 && (!busiestDay || d.totalTokens > busiestDay.totalTokens)) {
      busiestDay = { date: d.date, totalTokens: d.totalTokens }
    }
  }

  let prevDelta: number | null = null
  if (from !== null) {
    const prevTo = parseLocalDate(from)
    prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo)
    prevFrom.setDate(prevFrom.getDate() - (days - 1))
    const prevFromIso = localDateString(prevFrom)
    const prevToIso = localDateString(prevTo)
    const prevTotal = daily
      .filter((d) => d.date >= prevFromIso && d.date <= prevToIso)
      .reduce((s, d) => s + d.totalTokens, 0)
    if (prevTotal > 0) prevDelta = (total - prevTotal) / prevTotal
  }

  return { days, activeDays, avgPerDay: total / days, busiestDay, prevDelta }
}

export interface WeekdayAvg {
  /** 0=周一 .. 6=周日(与 isoWeekStart 的约定一致) */
  dow: number
  avg: number
}

/** 周一~周日的日均用量;输入为补零后的区间 daily(selectRangeDaily),缺日按 0 计入平均 */
export function weekdayAverages(filledDaily: DailyUsage[]): WeekdayAvg[] {
  const sums = new Array<number>(7).fill(0)
  const counts = new Array<number>(7).fill(0)
  for (const d of filledDaily) {
    const dow = (parseLocalDate(d.date).getDay() + 6) % 7
    sums[dow] += d.totalTokens
    counts[dow] += 1
  }
  return sums.map((sum, dow) => ({ dow, avg: counts[dow] > 0 ? sum / counts[dow] : 0 }))
}

export interface ShareDrift {
  dates: string[]
  /** 系列名,按区间总量降序;超出 topN 的合并为末尾的 'Other' */
  names: string[]
  /** shares[i] 对应 names[i],每项为该日占比 0..100;当日总量为 0 时全系列为 0 */
  shares: number[][]
}

/** 每日 agent/model 占比序列(100% 堆叠面积图用);输入为补零后的区间 daily */
export function shareDrift(
  filledDaily: DailyUsage[],
  mode: 'agents' | 'models',
  topN = Number.POSITIVE_INFINITY
): ShareDrift {
  const dates = filledDaily.map((d) => d.date)
  const perDay = filledDaily.map((day) => {
    const m = new Map<string, number>()
    if (mode === 'agents') {
      for (const a of day.agents) {
        const key = agentKeyOf(a)
        m.set(key, (m.get(key) ?? 0) + a.totalTokens)
      }
    } else {
      for (const a of day.agents) {
        for (const md of a.models) m.set(md.model, (m.get(md.model) ?? 0) + md.totalTokens)
      }
    }
    return m
  })

  const totals = new Map<string, number>()
  for (const m of perDay) {
    for (const [k, v] of m) totals.set(k, (totals.get(k) ?? 0) + v)
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const names = ranked.slice(0, topN).map(([k]) => k)
  const topSet = new Set(names)
  if (ranked.length > topN) names.push('Other')

  const shares = names.map((name) =>
    perDay.map((m) => {
      const dayTotal = [...m.values()].reduce((s, v) => s + v, 0)
      if (dayTotal <= 0) return 0
      let v = 0
      if (name === 'Other') {
        for (const [k, val] of m) if (!topSet.has(k)) v += val
      } else {
        v = m.get(name) ?? 0
      }
      return (v / dayTotal) * 100
    })
  )
  return { dates, names, shares }
}

export interface HourBucket {
  /** 本地小时 0..23 */
  hour: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  agents: Record<string, number>
  models: Record<string, number>
}

/**
 * 某日 session 用量按小时分桶(Today 活动图用)。恒返回 24 桶。
 * 口径:session 以其 lastActivity(UTC ISO → 本地时区)所在小时归档;
 * 长会话的全部 token 记在收尾小时——UI 必须如实标注该口径。
 */
export function sessionsHourlyBuckets(sessions: SessionUsage[], date: string): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    agents: {},
    models: {}
  }))
  for (const s of sessions) {
    if (!s.lastActivity) continue
    const t = new Date(s.lastActivity)
    if (Number.isNaN(t.getTime()) || localDateString(t) !== date) continue
    const b = buckets[t.getHours()]
    b.totalTokens += s.totalTokens
    b.inputTokens += s.inputTokens
    b.outputTokens += s.outputTokens
    b.cacheReadTokens += s.cacheReadTokens
    b.cacheCreationTokens += s.cacheCreationTokens
    const sKey = agentKeyOf(s)
    b.agents[sKey] = (b.agents[sKey] ?? 0) + s.totalTokens
    for (const m of s.models) {
      b.models[m.model] = (b.models[m.model] ?? 0) + m.totalTokens
    }
  }
  return buckets
}
