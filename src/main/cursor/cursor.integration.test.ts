/**
 * 真实 Cursor 登录态集成测试:读 state.vscdb → 调官方接口。
 * 无登录态的环境(CI / 未装 Cursor)自动跳过;网络失败时 status 为 skipped 而非抛异常。
 */
import { describe, expect, it } from 'vitest'
import { cursorCredentialExists } from './auth'
import { collectCursorUsage } from './index'

const hasLogin = cursorCredentialExists()

describe.skipIf(!hasLogin)('cursor integration (real login)', () => {
  it('collects daily usage from Cursor API, fail-soft', async () => {
    const { daily, status } = await collectCursorUsage()
    if (status.state === 'skipped') {
      // 网络/认证失败只落状态,不抛(CI 离线时放行)
      expect(status.reason).toBeTruthy()
      return
    }
    expect(status.state).toBe('ok')
    expect(daily).not.toBeNull()
    for (const d of daily!) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.agents.map((a) => a.agent)).toEqual(['cursor'])
      expect(d.totalTokens).toBeGreaterThanOrEqual(0)
    }
  })
})
