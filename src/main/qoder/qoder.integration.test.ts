import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectQoderUsage } from './index'
import { qoderDbPath } from './reader'

/** 真实本机 Qoder local.db 集成测试;无 db 的环境(CI)自动跳过 */
const hasDb = existsSync(qoderDbPath())

describe.skipIf(!hasDb)('qoder integration (real local db)', () => {
  it('reads chat_message and normalizes daily usage', () => {
    const { daily, status } = collectQoderUsage()
    expect(status.state).toBe('ok')
    expect(daily).not.toBeNull()
    expect(daily!.length).toBeGreaterThan(0)

    for (const d of daily!) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.agents.map((a) => a.agent)).toEqual(['qoder'])
      expect(d.totalTokens).toBeGreaterThan(0)
      // 三项之和 == total(归一化内部一致;无 cache creation)
      const sum = d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreationTokens
      expect(sum).toBe(d.totalTokens)
    }
    // 日期升序
    const dates = daily!.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)
  })
})
