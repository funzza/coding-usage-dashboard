import { describe, expect, it } from 'vitest'
import { adaptDailyReport } from '../main/ccusage/adapter'
import { mergeDailyIntoSnapshot, zeroUsage } from './usage-model'
import type { AgentUsage, DailyUsage } from './usage-model'

const ENGINE = { version: '20.0.20', path: 'ccusage' }
const NOW = new Date(2026, 7, 22, 12, 0, 0) // 2026-08-22 本地时间

function agentUsage(agent: string, total: number): AgentUsage {
  return { ...zeroUsage(), inputTokens: total, totalTokens: total, agent, models: [] }
}

function day(date: string, agents: AgentUsage[]): DailyUsage {
  const d: DailyUsage = { date, ...zeroUsage(), agents }
  for (const a of agents) {
    d.inputTokens += a.inputTokens
    d.totalTokens += a.totalTokens
  }
  return d
}

describe('mergeDailyIntoSnapshot', () => {
  it('merges a new date and recomputes totals/today/agents', () => {
    const snapshot = adaptDailyReport(
      { daily: [{ period: '2026-08-22', inputTokens: 100, agents: [{ agent: 'kimi', inputTokens: 100 }] }] },
      ENGINE,
      NOW
    )
    mergeDailyIntoSnapshot(snapshot, [day('2026-08-22', [agentUsage('zcode', 50)])], NOW)

    expect(snapshot.daily).toHaveLength(1)
    expect(snapshot.daily[0].agents.map((a) => a.agent)).toEqual(['kimi', 'zcode'])
    expect(snapshot.totals.totalTokens).toBe(150)
    expect(snapshot.today.totalTokens).toBe(150)
    expect(snapshot.agents.map((a) => a.agent)).toEqual(['kimi', 'zcode'])
  })

  it('inserts earlier dates keeping ascending order and extends range.from', () => {
    const snapshot = adaptDailyReport(
      { daily: [{ period: '2026-08-20', inputTokens: 10, agents: [{ agent: 'kimi', inputTokens: 10 }] }] },
      ENGINE,
      NOW
    )
    mergeDailyIntoSnapshot(snapshot, [day('2026-08-11', [agentUsage('zcode', 5)])], NOW)

    expect(snapshot.daily.map((d) => d.date)).toEqual(['2026-08-11', '2026-08-20'])
    expect(snapshot.range.from).toBe('2026-08-11')
    expect(snapshot.totals.totalTokens).toBe(15)
    expect(snapshot.last30Days.totalTokens).toBe(15)
  })

  it('merges same-day same-agent model breakdowns without double counting', () => {
    const snapshot = adaptDailyReport(
      { daily: [{ period: '2026-08-22', inputTokens: 100, agents: [{ agent: 'kimi', inputTokens: 100 }] }] },
      ENGINE,
      NOW
    )
    mergeDailyIntoSnapshot(snapshot, [day('2026-08-22', [agentUsage('kimi', 40)])], NOW)
    expect(snapshot.totals.totalTokens).toBe(140)
  })

  it('is a no-op for empty extra', () => {
    const snapshot = adaptDailyReport(
      { daily: [{ period: '2026-08-22', inputTokens: 100, agents: [{ agent: 'kimi', inputTokens: 100 }] }] },
      ENGINE,
      NOW
    )
    const before = JSON.stringify(snapshot)
    mergeDailyIntoSnapshot(snapshot, [], NOW)
    expect(JSON.stringify(snapshot)).toBe(before)
  })
})
