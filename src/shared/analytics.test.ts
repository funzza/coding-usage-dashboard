import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptDailyReport } from '../main/ccusage/adapter'
import type { CcusageDailyReport } from '../main/ccusage/types'
import type { UsageSnapshot } from './usage-model'
import {
  aggregateAgentModels,
  aggregateModels,
  bucketDaily,
  bucketLabel,
  cacheReadShare,
  filterDailyByRange,
  isoWeekStart,
  milestonesOf,
  rangeStats,
  selectRangeDaily,
  sessionsHourlyBuckets,
  shareDrift,
  sumDaily,
  usageMilestones,
  usageTier,
  weekdayAverages
} from './analytics'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/ccusage-daily-by-agent.json'), 'utf-8')
) as CcusageDailyReport

// fixture 最后一天为 2026-08-21,起于 2026-05-15(5/16~5/27 无数据)
const now = new Date(2026, 7, 21, 12, 0, 0)
const snapshot: UsageSnapshot = adaptDailyReport(fixture, { version: '20.0.20', path: 'x' }, now)

describe('range filtering & gap filling', () => {
  it('today selects exactly the last day', () => {
    const days = filterDailyByRange(snapshot.daily, 'today', now)
    expect(days.map((d) => d.date)).toEqual(['2026-08-21'])
  })

  it('7d / 30d sums match adapter snapshot windows', () => {
    expect(sumDaily(filterDailyByRange(snapshot.daily, '7d', now)).totalTokens).toBe(
      snapshot.last7Days.totalTokens
    )
    expect(sumDaily(filterDailyByRange(snapshot.daily, '30d', now)).totalTokens).toBe(
      snapshot.last30Days.totalTokens
    )
    expect(sumDaily(filterDailyByRange(snapshot.daily, 'all', now)).totalTokens).toBe(
      snapshot.totals.totalTokens
    )
  })

  it('fillMissingDays produces a continuous axis', () => {
    const days30 = selectRangeDaily(snapshot.daily, '30d', now)
    expect(days30.length).toBe(30)
    expect(days30[0].date).toBe('2026-07-23')
    expect(days30[29].date).toBe('2026-08-21')
    for (let i = 1; i < days30.length; i++) {
      const prev = new Date(days30[i - 1].date)
      prev.setDate(prev.getDate() + 1)
      expect(days30[i].date).toBe(
        `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
      )
    }
  })

  it('all range fills from first data day', () => {
    const daysAll = selectRangeDaily(snapshot.daily, 'all', now)
    expect(daysAll[0].date).toBe('2026-05-15')
    expect(daysAll[daysAll.length - 1].date).toBe('2026-08-21')
    expect(daysAll.length).toBe(99) // 5/15→8/21 inclusive
    // 补零行为:5/16 原数据不存在,应为零行
    const gap = daysAll.find((d) => d.date === '2026-05-16')
    expect(gap?.totalTokens).toBe(0)
    // 填充不改变总量
    expect(sumDaily(daysAll).totalTokens).toBe(snapshot.totals.totalTokens)
  })
})

describe('bucketDaily', () => {
  const day = (date: string, total: number, cost = 0, agents: never[] = []) =>
    ({
      date,
      inputTokens: total,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: total,
      totalCost: cost,
      agents
    }) as never

  it('returns empty / passthrough for edge cases', () => {
    expect(bucketDaily([], 'week')).toEqual([])
    expect(bucketDaily([], 'month')).toEqual([])
    const days = [day('2026-08-21', 10)]
    expect(bucketDaily(days, 'day')).toBe(days)
  })

  it('isoWeekStart snaps to Monday (local)', () => {
    expect(isoWeekStart('2026-08-17')).toBe('2026-08-17') // Monday itself
    expect(isoWeekStart('2026-08-21')).toBe('2026-08-17') // Friday
    expect(isoWeekStart('2026-08-23')).toBe('2026-08-17') // Sunday
    expect(isoWeekStart('2026-08-01')).toBe('2026-07-27') // 跨月:周六归入 7/27 周
  })

  it('week buckets merge across month boundary and keep all token fields', () => {
    const days = [
      day('2026-07-31', 100, 1.5),
      day('2026-08-01', 200, 2.5),
      day('2026-08-03', 50, 0.5)
    ]
    const buckets = bucketDaily(days, 'week')
    expect(buckets.map((b) => b.date)).toEqual(['2026-07-27', '2026-08-03'])
    expect(buckets[0]).toMatchObject({ totalTokens: 300, inputTokens: 300, totalCost: 4 })
    expect(buckets[1]).toMatchObject({ totalTokens: 50 })
    // 聚合不改变总量
    expect(sumDaily(buckets).totalTokens).toBe(350)
  })

  it('week bucket for a partial week starts at its Monday', () => {
    // 只有周日一天数据,bucket date 仍是该周周一
    const buckets = bucketDaily([day('2026-08-23', 7)], 'week')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].date).toBe('2026-08-17')
  })

  it('month buckets are calendar months', () => {
    const days = [day('2026-07-15', 10), day('2026-07-31', 20), day('2026-08-01', 5)]
    const buckets = bucketDaily(days, 'month')
    expect(buckets.map((b) => b.date)).toEqual(['2026-07-01', '2026-08-01'])
    expect(buckets[0].totalTokens).toBe(30)
    expect(buckets[1].totalTokens).toBe(5)
  })

  it('merges agent breakdowns across days within a bucket', () => {
    const daily = [
      {
        date: '2026-08-17',
        ...{ inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 10, totalCost: 0 },
        agents: [
          { agent: 'claude', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 10, totalCost: 0, models: [] }
        ]
      },
      {
        date: '2026-08-18',
        ...{ inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 5, totalCost: 0 },
        agents: [
          { agent: 'claude', inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 5, totalCost: 0, models: [] },
          { agent: 'kimi', inputTokens: 0, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 3, totalCost: 0, models: [] }
        ]
      }
    ] as never
    const buckets = bucketDaily(daily, 'week')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].agents.map((a: { agent: string }) => a.agent)).toEqual(['claude', 'kimi'])
    expect(buckets[0].agents[0].totalTokens).toBe(15)
  })

  it('bucketLabel formats axis labels per granularity', () => {
    expect(bucketLabel('2026-08-21', 'day')).toBe('08-21')
    expect(bucketLabel('2026-08-17', 'week')).toBe('8/17')
    expect(bucketLabel('2026-08-01', 'month')).toBe('Aug')
  })
})

describe('model dimension', () => {
  it('aggregates a shared model across agents', () => {
    // muse-spark-1.2-contributor 同时被 claude 和 opencode 使用
    const expected = snapshot.daily.reduce((acc, day) => {
      for (const agent of day.agents) {
        const m = agent.models.find((x) => x.model === 'muse-spark-1.2-contributor')
        if (m) acc += m.totalTokens
      }
      return acc
    }, 0)

    const models = aggregateModels(snapshot.daily)
    const muse = models.find((m) => m.model === 'muse-spark-1.2-contributor')
    expect(muse).toBeDefined()
    expect(muse!.totalTokens).toBe(expected)
    expect(muse!.totalTokens).toBeGreaterThan(0)
    expect(muse!.agents.map((a) => a.agent).sort()).toEqual(['claude', 'opencode'])
    // 交叉明细之和 = 模型总量
    expect(muse!.agents.reduce((acc, a) => acc + a.totalTokens, 0)).toBe(muse!.totalTokens)
  })

  it('per-agent model aggregation matches agent totals', () => {
    const kimiModels = aggregateAgentModels(snapshot.daily, 'kimi')
    const kimiTotal = snapshot.agents.find((a) => a.agent === 'kimi')!
    const modelSum = kimiModels.reduce((acc, m) => acc + m.totalTokens, 0)
    // 模型 totalTokens 由四项构成,agent 级 totalTokens 可能含其他 token,允许 >=
    expect(modelSum).toBeGreaterThan(0)
    expect(modelSum).toBeLessThanOrEqual(kimiTotal.totalTokens)
  })
})

describe('cacheReadShare', () => {
  it('is cacheRead / (cacheRead + input)', () => {
    expect(cacheReadShare({ inputTokens: 25, cacheReadTokens: 75 } as never)).toBe(0.75)
    expect(cacheReadShare({ inputTokens: 0, cacheReadTokens: 0 } as never)).toBe(0)
  })
})

describe('usageMilestones / usageTier', () => {
  const day = (date: string, totalTokens: number) => ({ date, totalTokens }) as never

  it('returns null on empty history (new user)', () => {
    expect(usageMilestones([], '2026-08-21')).toBeNull()
    // 只有今天一天也算空历史
    expect(usageMilestones([day('2026-08-21', 100)], '2026-08-21')).toBeNull()
    expect(usageTier(100, null)).toBe('brand')
  })

  it('computes quantiles by linear interpolation over days before today', () => {
    // 历史 1..10(乱序、含今天之外的日期),sorted[q*(n-1)] 插值
    const daily = [
      day('2026-08-21', 999), // 今天,必须排除
      day('2026-08-10', 10),
      day('2026-08-01', 1),
      day('2026-08-05', 5),
      day('2026-08-03', 3),
      day('2026-08-09', 9),
      day('2026-08-02', 2),
      day('2026-08-07', 7),
      day('2026-08-04', 4),
      day('2026-08-08', 8),
      day('2026-08-06', 6)
    ]
    const m = usageMilestones(daily, '2026-08-21')!
    // n=10:median = 5.5,p75 = 7.75,p90 = 9.1
    expect(m.median).toBe(5.5)
    expect(m.p75).toBe(7.75)
    expect(m.p90).toBeCloseTo(9.1, 10)
  })

  it('includes zero-token days honestly', () => {
    const daily = [day('2026-08-19', 0), day('2026-08-20', 0), day('2026-08-21', 50)]
    const m = usageMilestones(daily, '2026-08-21')!
    expect(m).toEqual({ median: 0, p75: 0, p90: 0 })
    // 全零历史下任何正用量都到顶档
    expect(usageTier(50, m)).toBe('blazing')
  })

  it('assigns tiers by which interval today falls into', () => {
    const m = { median: 100, p75: 200, p90: 300 }
    expect(usageTier(0, m)).toBe('cool')
    expect(usageTier(99, m)).toBe('cool')
    expect(usageTier(100, m)).toBe('brand')
    expect(usageTier(199, m)).toBe('brand')
    expect(usageTier(200, m)).toBe('warm')
    expect(usageTier(299, m)).toBe('warm')
    expect(usageTier(300, m)).toBe('blazing')
  })

  it('matches real fixture data (today 2026-08-21 excluded)', () => {
    const m = usageMilestones(snapshot.daily, '2026-08-21')!
    expect(m.median).toBe(42025277)
    expect(m.p75).toBeCloseTo(181446379.5, 6)
    expect(m.p90).toBeCloseTo(317004015.4, 6)
    expect(usageTier(snapshot.today.totalTokens, m)).toBe('brand')
  })
})

describe('milestonesOf', () => {
  it('null on empty, quantiles on unsorted input', () => {
    expect(milestonesOf([])).toBeNull()
    expect(milestonesOf([10, 1, 5, 3, 9, 2, 7, 4, 8, 6])).toEqual({ median: 5.5, p75: 7.75, p90: 9.1 })
  })
})

describe('rangeStats', () => {
  it('today: single day, prev = yesterday', () => {
    const s = rangeStats(snapshot.daily, 'today', now)
    expect(s.days).toBe(1)
    expect(s.activeDays).toBe(1)
    expect(s.avgPerDay).toBe(snapshot.today.totalTokens)
    expect(s.busiestDay).toEqual({ date: '2026-08-21', totalTokens: snapshot.today.totalTokens })
    const yesterday = snapshot.daily.find((d) => d.date === '2026-08-20')!
    const expected = (snapshot.today.totalTokens - yesterday.totalTokens) / yesterday.totalTokens
    expect(s.prevDelta).toBeCloseTo(expected, 10)
  })

  it('7d / 30d: window length and prev-period delta', () => {
    const s7 = rangeStats(snapshot.daily, '7d', now)
    expect(s7.days).toBe(7)
    const cur7 = sumDaily(filterDailyByRange(snapshot.daily, '7d', now)).totalTokens
    const prev7 = snapshot.daily
      .filter((d) => d.date >= '2026-08-08' && d.date <= '2026-08-14')
      .reduce((acc, d) => acc + d.totalTokens, 0)
    expect(s7.prevDelta).toBeCloseTo((cur7 - prev7) / prev7, 10)

    const s30 = rangeStats(snapshot.daily, '30d', now)
    expect(s30.days).toBe(30)
    expect(s30.busiestDay).not.toBeNull()
    expect(s30.avgPerDay).toBeCloseTo(
      sumDaily(filterDailyByRange(snapshot.daily, '30d', now)).totalTokens / 30,
      6
    )
  })

  it('all: actual span, no prev delta', () => {
    const s = rangeStats(snapshot.daily, 'all', now)
    expect(s.days).toBe(99)
    expect(s.prevDelta).toBeNull()
    expect(s.busiestDay?.totalTokens).toBeGreaterThan(0)
  })

  it('prevDelta null when previous period has no data', () => {
    const only = snapshot.daily.filter((d) => d.date >= '2026-08-20')
    expect(rangeStats(only, '7d', now).prevDelta).toBeNull()
  })

  it('busiestDay null when all zero; empty input is safe', () => {
    const zero = [{ date: '2026-08-21', totalTokens: 0 } as never]
    expect(rangeStats(zero, 'today', now).busiestDay).toBeNull()
    const empty = rangeStats([], '7d', now)
    expect(empty.days).toBe(7)
    expect(empty.activeDays).toBe(0)
    expect(empty.avgPerDay).toBe(0)
  })
})

describe('weekdayAverages', () => {
  const day = (date: string, totalTokens: number) => ({ date, totalTokens }) as never

  it('groups by weekday, Monday = 0', () => {
    // 2026-08-17 是周一
    const days = [day('2026-08-17', 100), day('2026-08-18', 200), day('2026-08-23', 60)]
    const res = weekdayAverages(days)
    expect(res).toHaveLength(7)
    expect(res[0]).toEqual({ dow: 0, avg: 100 }) // Mon
    expect(res[1]).toEqual({ dow: 1, avg: 200 }) // Tue
    expect(res[6]).toEqual({ dow: 6, avg: 60 }) // Sun
    expect(res[2].avg).toBe(0)
  })

  it('averages multiple occurrences of the same weekday', () => {
    const days = [day('2026-08-10', 100), day('2026-08-17', 300)] // 两个周一
    expect(weekdayAverages(days)[0].avg).toBe(200)
  })
})

describe('shareDrift', () => {
  const mkDay = (date: string, agents: Array<[string, number]>) =>
    ({
      date,
      agents: agents.map(([agent, totalTokens]) => ({ agent, totalTokens, models: [] }))
    }) as never

  it('shares per day sum to 100 when day has usage', () => {
    const days = [
      mkDay('2026-08-20', [['claude', 75], ['kimi', 25]]),
      mkDay('2026-08-21', [['claude', 50], ['kimi', 50]])
    ]
    const d = shareDrift(days, 'agents')
    expect(d.dates).toEqual(['2026-08-20', '2026-08-21'])
    expect(d.names).toEqual(['claude', 'kimi'])
    expect(d.shares[0]).toEqual([75, 50])
    expect(d.shares[1]).toEqual([25, 50])
    for (let i = 0; i < 2; i++) {
      expect(d.shares.reduce((acc, s) => acc + s[i], 0)).toBeCloseTo(100, 6)
    }
  })

  it('merges beyond topN into Other; zero-total day yields all-zero shares', () => {
    const days = [
      mkDay('2026-08-20', [['a', 10], ['b', 20], ['c', 30]]),
      mkDay('2026-08-21', [])
    ]
    const d = shareDrift(days, 'agents', 1)
    expect(d.names).toEqual(['c', 'Other'])
    expect(d.shares[0][0]).toBeCloseTo(50, 6)
    expect(d.shares[1][0]).toBeCloseTo(50, 6)
    expect(d.shares[0][1]).toBe(0)
    expect(d.shares[1][1]).toBe(0)
  })

  it('model mode reads across agents', () => {
    const days = [
      {
        date: '2026-08-21',
        agents: [
          { agent: 'claude', totalTokens: 60, models: [{ model: 'm1', totalTokens: 60 }] },
          { agent: 'kimi', totalTokens: 40, models: [{ model: 'm2', totalTokens: 40 }] }
        ]
      }
    ] as never
    const d = shareDrift(days, 'models')
    expect(d.names.sort()).toEqual(['m1', 'm2'])
    expect(d.shares[d.names.indexOf('m1')][0]).toBeCloseTo(60, 6)
  })
})

describe('sessionsHourlyBuckets', () => {
  const mkSession = (iso: string | null, agent: string, totalTokens: number, models: Array<[string, number]> = []) =>
    ({
      lastActivity: iso,
      agent,
      totalTokens,
      inputTokens: totalTokens / 2,
      outputTokens: 0,
      cacheReadTokens: totalTokens / 2,
      cacheCreationTokens: 0,
      models: models.map(([model, t]) => ({ model, totalTokens: t }))
    }) as never

  it('buckets by local hour of lastActivity; skips null/invalid/other dates', () => {
    // 用本地时间构造 ISO,保证任意 TZ 下小时稳定
    const local = (h: number, day = 21) => new Date(2026, 7, day, h, 30, 0).toISOString()
    const date = '2026-08-21'
    const sessions = [
      mkSession(local(15), 'claude', 100, [['m1', 100]]),
      mkSession(local(15), 'kimi', 50),
      mkSession(local(9), 'claude', 30),
      mkSession(null, 'claude', 999),
      mkSession('not-a-date', 'claude', 999),
      mkSession(local(10, 20), 'claude', 999) // 前一天
    ]
    const buckets = sessionsHourlyBuckets(sessions, date)
    expect(buckets).toHaveLength(24)
    expect(buckets[15].totalTokens).toBe(150)
    expect(buckets[15].inputTokens).toBe(75)
    expect(buckets[15].cacheReadTokens).toBe(75)
    expect(buckets[15].agents).toEqual({ claude: 100, kimi: 50 })
    expect(buckets[15].models).toEqual({ m1: 100 })
    expect(buckets[9].totalTokens).toBe(30)
    expect(buckets.reduce((acc, b) => acc + b.totalTokens, 0)).toBe(180)
  })
})
