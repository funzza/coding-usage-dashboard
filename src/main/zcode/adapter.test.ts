import { describe, expect, it } from 'vitest'
import { adaptZcodeRows, ZCODE_AGENT } from './adapter'
import type { ZcodeDailyModelRow } from './reader'

function row(partial: Partial<ZcodeDailyModelRow>): ZcodeDailyModelRow {
  return {
    day: '2026-08-21',
    model: 'deepseek-v4-flash',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 1,
    ...partial
  }
}

describe('adaptZcodeRows', () => {
  it('normalizes zcode token semantics (input includes cache, reasoning counts as output)', () => {
    // 真实样本:input 107032 含 cacheRead 106368,computed_total = input+output = 107874
    const [day] = adaptZcodeRows([
      row({ inputTokens: 107032, outputTokens: 842, reasoningTokens: 0, cacheReadTokens: 106368 })
    ])
    const m = day.agents[0].models[0]
    expect(m.inputTokens).toBe(664) // 107032 - 106368,新鲜 input
    expect(m.outputTokens).toBe(842)
    expect(m.cacheReadTokens).toBe(106368)
    expect(m.totalTokens).toBe(107874) // 四项之和 == computed_total
    expect(m.totalCost).toBe(0)
    expect(day.totalTokens).toBe(107874)
  })

  it('counts reasoning tokens as output', () => {
    const [day] = adaptZcodeRows([row({ inputTokens: 100, outputTokens: 10, reasoningTokens: 5 })])
    const m = day.agents[0].models[0]
    expect(m.outputTokens).toBe(15)
    expect(m.totalTokens).toBe(115)
  })

  it('clamps negative fresh input when cache exceeds input (defensive)', () => {
    const [day] = adaptZcodeRows([row({ inputTokens: 50, cacheReadTokens: 80 })])
    expect(day.agents[0].models[0].inputTokens).toBe(0)
  })

  it('groups by day with a single zcode agent, days ascending', () => {
    const daily = adaptZcodeRows([
      row({ day: '2026-08-22', model: 'GLM-5.3', inputTokens: 10 }),
      row({ day: '2026-08-21', model: 'GLM-5.3', inputTokens: 20 }),
      row({ day: '2026-08-22', model: 'qwen3.8-max', inputTokens: 5 })
    ])
    expect(daily.map((d) => d.date)).toEqual(['2026-08-21', '2026-08-22'])
    for (const d of daily) {
      expect(d.agents.map((a) => a.agent)).toEqual([ZCODE_AGENT])
    }
    const day22 = daily[1]
    expect(day22.agents[0].models.map((m) => m.model)).toEqual(['GLM-5.3', 'qwen3.8-max'])
    expect(day22.totalTokens).toBe(15)
  })

  it('returns [] for no rows', () => {
    expect(adaptZcodeRows([])).toEqual([])
  })
})
