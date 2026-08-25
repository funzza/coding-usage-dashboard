import { describe, expect, it } from 'vitest'
import { adaptDshRows, DSH_AGENT } from './adapter'
import type { DshDailyModelRow } from './reader'

function row(partial: Partial<DshDailyModelRow>): DshDailyModelRow {
  return {
    day: '2026-08-21',
    model: 'deepseek-v4-flash',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    calls: 1,
    ...partial
  }
}

describe('adaptDshRows', () => {
  it('uses input as-is (already uncached) and sums total from three parts', () => {
    // 与官方 projcache 对账口径:total = input + output + cacheRead,无 cache creation
    const [day] = adaptDshRows([row({ inputTokens: 6324, outputTokens: 235, cacheReadTokens: 6912 })])
    const m = day.agents[0].models[0]
    expect(m.inputTokens).toBe(6324)
    expect(m.outputTokens).toBe(235)
    expect(m.cacheReadTokens).toBe(6912)
    expect(m.cacheCreationTokens).toBe(0)
    expect(m.totalTokens).toBe(13471)
    expect(m.totalCost).toBe(0)
    expect(day.totalTokens).toBe(13471)
  })

  it('groups by day with a single dsh agent, days ascending', () => {
    const daily = adaptDshRows([
      row({ day: '2026-08-22', inputTokens: 10 }),
      row({ day: '2026-08-21', model: 'deepseek-v4-pro', inputTokens: 20 }),
      row({ day: '2026-08-21', inputTokens: 5 })
    ])
    expect(daily.map((d) => d.date)).toEqual(['2026-08-21', '2026-08-22'])
    for (const d of daily) {
      expect(d.agents.map((a) => a.agent)).toEqual([DSH_AGENT])
    }
    expect(daily[0].totalTokens).toBe(25)
    expect(daily[0].agents[0].models).toHaveLength(2)
  })

  it('returns [] for no rows', () => {
    expect(adaptDshRows([])).toEqual([])
  })
})
