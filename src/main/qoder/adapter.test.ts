import { describe, expect, it } from 'vitest'
import { adaptQoderRows, QODER_AGENT } from './adapter'
import type { QoderDailyModelRow } from './reader'

function row(partial: Partial<QoderDailyModelRow>): QoderDailyModelRow {
  return {
    day: '2026-08-21',
    model: 'Qwen-3.8-Max',
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    requests: 1,
    ...partial
  }
}

describe('adaptQoderRows', () => {
  it('normalizes qoder token semantics (prompt_tokens includes cached_tokens)', () => {
    // 真实样本:prompt 31097 含 cached 24650,completion 224
    const [day] = adaptQoderRows([
      row({ promptTokens: 31097, completionTokens: 224, cachedTokens: 24650 })
    ])
    const m = day.agents[0].models[0]
    expect(m.inputTokens).toBe(6447) // 31097 - 24650,新鲜 input
    expect(m.outputTokens).toBe(224)
    expect(m.cacheReadTokens).toBe(24650)
    expect(m.cacheCreationTokens).toBe(0)
    expect(m.totalTokens).toBe(31321) // 三项之和 == prompt + completion
    expect(m.totalCost).toBe(0)
    expect(day.totalTokens).toBe(31321)
  })

  it('clamps negative fresh input when cached exceeds prompt (defensive)', () => {
    const [day] = adaptQoderRows([row({ promptTokens: 50, cachedTokens: 80 })])
    expect(day.agents[0].models[0].inputTokens).toBe(0)
  })

  it('groups by day with a single qoder agent, days ascending', () => {
    const daily = adaptQoderRows([
      row({ day: '2026-08-22', model: 'Qwen-3.8-Max', promptTokens: 10 }),
      row({ day: '2026-08-21', model: 'Qwen-3.8-Max', promptTokens: 20 }),
      row({ day: '2026-08-22', model: 'qmodel_preview', promptTokens: 5 })
    ])
    expect(daily.map((d) => d.date)).toEqual(['2026-08-21', '2026-08-22'])
    for (const d of daily) {
      expect(d.agents.map((a) => a.agent)).toEqual([QODER_AGENT])
    }
    const day22 = daily[1]
    expect(day22.agents[0].models.map((m) => m.model)).toEqual(['Qwen-3.8-Max', 'qmodel_preview'])
    expect(day22.totalTokens).toBe(15)
  })

  it('returns [] for no rows', () => {
    expect(adaptQoderRows([])).toEqual([])
  })
})
