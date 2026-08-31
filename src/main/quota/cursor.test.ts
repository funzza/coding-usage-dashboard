/**
 * Cursor 额度解析测试。
 * fixture 来自 2026-08-31 本机实测真实响应(Pro 账号,已脱敏,见 docs/quota-research-cursor.md)。
 */
import { describe, expect, it } from 'vitest'
import { parseCursorUsageSummary } from './cursor'

const REAL_SUMMARY = {
  billingCycleStart: '2026-08-31T08:57:05.000Z',
  billingCycleEnd: '2026-09-30T08:57:05.000Z',
  membershipType: 'pro',
  limitType: 'user',
  isUnlimited: false,
  autoModelSelectedDisplayMessage: "You've used 10% of your included total usage",
  namedModelSelectedDisplayMessage: "You've used 0% of your included API usage",
  individualUsage: {
    plan: {
      enabled: true,
      used: 2000,
      limit: 2000,
      remaining: 0,
      breakdown: { included: 2000, bonus: 2730, total: 4730 },
      autoPercentUsed: 10.511111111111111,
      apiPercentUsed: 0,
      totalPercentUsed: 9.777777777777779
    },
    onDemand: { enabled: false, used: 0, limit: null, remaining: null }
  },
  teamUsage: {}
}

describe('parseCursorUsageSummary', () => {
  it('解析真实响应:窗口 + extras + plan', () => {
    const { windows, extras, plan } = parseCursorUsageSummary(REAL_SUMMARY)
    expect(plan).toBe('Pro')
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      key: 'included',
      label: 'Included usage',
      resetsAt: '2026-09-30T08:57:05.000Z'
    })
    // 百分比优先用服务端加权值
    expect(windows[0].usedPercent).toBeCloseTo(9.777777777777779)
    expect(extras).toContainEqual({ label: 'Plan', value: 'Pro' })
    expect(extras).toContainEqual({ label: 'Requests', value: '2000 / 2000 requests +2730 bonus' })
  })

  it('totalPercentUsed 缺失时用 used/total 兜底', () => {
    const json = structuredClone(REAL_SUMMARY)
    delete (json.individualUsage.plan as Record<string, unknown>).totalPercentUsed
    const { windows } = parseCursorUsageSummary(json)
    expect(windows[0].usedPercent).toBeCloseTo((2000 / 4730) * 100)
  })

  it('字段类型漂移仍能容错', () => {
    const json = {
      ...REAL_SUMMARY,
      membershipType: 42,
      individualUsage: { plan: { used: '2000', limit: '2000', breakdown: { total: 4730 } } }
    }
    const { windows, extras, plan } = parseCursorUsageSummary(json)
    expect(plan).toBeNull()
    expect(windows).toHaveLength(1)
    expect(windows[0].usedPercent).toBeCloseTo((2000 / 4730) * 100)
    expect(extras).toContainEqual({ label: 'Requests', value: '2000 / 2000 requests' })
  })

  it('窗口缺失抛错(上游彻底变了,额度不可信)', () => {
    expect(() => parseCursorUsageSummary({})).toThrow('Unexpected Cursor usage-summary shape')
  })
})
