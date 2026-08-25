import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectZcodeUsage } from './index'
import { zcodeDbPath } from './reader'

/** 真实本机 zcode db 集成测试;无 db 的环境(CI)自动跳过 */
const hasDb = existsSync(zcodeDbPath())

describe.skipIf(!hasDb)('zcode integration (real local db)', () => {
  it('reads model_usage and normalizes daily usage', () => {
    const { daily, status } = collectZcodeUsage()
    expect(status.state).toBe('ok')
    expect(daily).not.toBeNull()
    expect(daily!.length).toBeGreaterThan(0)

    for (const d of daily!) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.agents.map((a) => a.agent)).toEqual(['zcode'])
      expect(d.totalTokens).toBeGreaterThan(0)
      // 四项之和 == total(归一化内部一致)
      const sum = d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheCreationTokens
      expect(sum).toBe(d.totalTokens)
    }
    // 日期升序
    const dates = daily!.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)
  })
})
