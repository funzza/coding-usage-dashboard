import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectDshUsage } from './index'
import { dshSessionsRoot } from './reader'

/** 真实本机 dsh 会话库集成测试;无 ~/.dsh 的环境(CI)自动跳过 */
const hasDsh = existsSync(dshSessionsRoot())

describe.skipIf(!hasDsh)('dsh integration (real local sessions)', () => {
  // 首次全量解析约 3-5s(之后走 mtime 缓存),给足超时
  it('parses session.jsonl.zstd files and normalizes daily usage', { timeout: 30_000 }, () => {
    const { daily, status } = collectDshUsage()
    expect(status.state).toBe('ok')
    expect(daily).not.toBeNull()
    expect(daily!.length).toBeGreaterThan(0)

    for (const d of daily!) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.agents.map((a) => a.agent)).toEqual(['dsh'])
      expect(d.totalTokens).toBeGreaterThan(0)
      // total = input + output + cacheRead(无 cache creation)
      expect(d.cacheCreationTokens).toBe(0)
      const sum = d.inputTokens + d.outputTokens + d.cacheReadTokens
      expect(sum).toBe(d.totalTokens)
    }
    const dates = daily!.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)

    // 缓存路径:第二次采集结果一致(mtime 缓存不重解析)
    const again = collectDshUsage()
    expect(again.daily).toEqual(daily)
  })
})
