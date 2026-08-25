import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptDailyReport, adaptSessionReport } from './adapter'
import { localDateString } from '../../shared/usage-model'
import type { EngineInfo } from '../../shared/usage-model'
import type { CcusageDailyReport, CcusageSessionReport } from './types'

const engine: EngineInfo = { version: '20.0.20', path: 'C:\\ccusage.cmd' }

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/ccusage-daily-by-agent.json'), 'utf-8')
) as CcusageDailyReport

// fixture 最后一天为 2026-08-21
const now = new Date(2026, 7, 21, 12, 0, 0)

describe('adaptDailyReport (real fixture)', () => {
  const snapshot = adaptDailyReport(fixture, engine, now)

  it('keeps all days sorted ascending', () => {
    expect(snapshot.daily.length).toBe(fixture.daily!.length)
    const dates = snapshot.daily.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)
    expect(snapshot.range.from).toBe('2026-05-15')
    expect(snapshot.range.to).toBe('2026-08-21')
  })

  it('totals equal the sum of daily rows', () => {
    const sum = snapshot.daily.reduce((acc, d) => acc + d.totalTokens, 0)
    expect(snapshot.totals.totalTokens).toBe(sum)
    expect(snapshot.totals.totalTokens).toBeGreaterThan(0)
  })

  it('discovers agents dynamically from data', () => {
    const names = snapshot.agents.map((a) => a.agent).sort()
    expect(names).toEqual(['claude', 'codex', 'grok', 'kimi', 'opencode', 'pi'])
    for (const a of snapshot.agents) {
      expect(a.totalTokens).toBeGreaterThan(0)
      expect(a.models.length).toBeGreaterThan(0)
    }
  })

  it('computes today / 7d / 30d windows from local date', () => {
    const lastDay = snapshot.daily[snapshot.daily.length - 1]
    expect(snapshot.today.totalTokens).toBe(lastDay.totalTokens)

    const sum7 = snapshot.daily
      .filter((d) => d.date >= '2026-08-15')
      .reduce((acc, d) => acc + d.totalTokens, 0)
    expect(snapshot.last7Days.totalTokens).toBe(sum7)

    const sum30 = snapshot.daily
      .filter((d) => d.date >= '2026-07-23')
      .reduce((acc, d) => acc + d.totalTokens, 0)
    expect(snapshot.last30Days.totalTokens).toBe(sum30)
  })

  it('per-day agent rows carry model breakdowns', () => {
    const day = snapshot.daily[snapshot.daily.length - 1]
    const kimi = day.agents.find((a) => a.agent === 'kimi')
    expect(kimi).toBeDefined()
    expect(kimi!.models[0].model).toBe('k3-256k')
  })
})

describe('adaptDailyReport (tolerance)', () => {
  it('handles empty / malformed input without throwing', () => {
    const s = adaptDailyReport(undefined, engine, now)
    expect(s.daily).toEqual([])
    expect(s.totals.totalTokens).toBe(0)
    expect(s.range.from).toBe(localDateString(now))
  })

  it('treats missing fields as zero and skips rows without period', () => {
    const s = adaptDailyReport(
      {
        daily: [
          { inputTokens: 5 },
          { period: '2026-08-21', inputTokens: 5 },
          { period: '2026-08-20', agents: [{ agent: 'kimi', inputTokens: 1 }] }
        ]
      },
      engine,
      now
    )
    expect(s.daily.length).toBe(2)
    expect(s.today.totalTokens).toBe(5)
    expect(s.agents.map((a) => a.agent)).toEqual(['kimi'])
    expect(s.agents[0].totalTokens).toBe(1)
  })
})

const sessionFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/ccusage-session-by-agent.json'), 'utf-8')
) as CcusageSessionReport

describe('adaptSessionReport (real fixture)', () => {
  const report = adaptSessionReport(sessionFixture, engine, now)

  it('keeps all sessions sorted by lastActivity descending', () => {
    expect(report.sessions.length).toBe(sessionFixture.session!.length)
    const withTime = report.sessions.filter((s) => s.lastActivity)
    expect(withTime.length).toBeGreaterThan(0)
    for (let i = 1; i < withTime.length; i++) {
      expect(withTime[i - 1].lastActivity! >= withTime[i].lastActivity!).toBe(true)
    }
    // 无 lastActivity 的行排在有时间的之后
    const firstMissing = report.sessions.findIndex((s) => !s.lastActivity)
    if (firstMissing >= 0) {
      expect(report.sessions.slice(firstMissing).every((s) => !s.lastActivity)).toBe(true)
    }
  })

  it('normalizes id / agent / models from real rows', () => {
    const first = report.sessions[0]
    expect(first.id).toBeTruthy()
    expect(first.agent).toBeTruthy()
    expect(first.models.length).toBeGreaterThan(0)
    expect(first.totalTokens).toBeGreaterThan(0)
    // 真实数据里每个 session 只属于一个 agent
    const agents = new Set(report.sessions.map((s) => s.agent))
    expect(agents.has('claude')).toBe(true)
    expect(agents.has('kimi')).toBe(true)
  })

  it('totals equal the sum of sessions', () => {
    const sum = report.sessions.reduce((acc, s) => acc + s.totalTokens, 0)
    expect(report.totals.totalTokens).toBe(sum)
  })
})

describe('adaptSessionReport (tolerance)', () => {
  it('handles empty / malformed input without throwing', () => {
    const r = adaptSessionReport(undefined, engine, now)
    expect(r.sessions).toEqual([])
    expect(r.totals.totalTokens).toBe(0)
  })

  it('treats missing fields as zero/null and skips rows without period', () => {
    const r = adaptSessionReport(
      {
        session: [
          { inputTokens: 5 },
          { period: 'sess-1', inputTokens: 5 },
          { period: 'sess-2', agent: 'kimi', metadata: { lastActivity: '2026-08-20T01:00:00Z' }, modelsUsed: ['k3'] },
          { period: 'sess-3', agent: 'kimi', metadata: { lastActivity: '2026-08-21T01:00:00Z' } }
        ]
      },
      engine,
      now
    )
    expect(r.sessions.map((s) => s.id)).toEqual(['sess-3', 'sess-2', 'sess-1'])
    expect(r.sessions[2].lastActivity).toBeNull()
    expect(r.sessions[2].agent).toBe('unknown')
    expect(r.sessions[1].models[0].model).toBe('k3')
    expect(r.totals.inputTokens).toBe(5)
  })
})
