/**
 * quota provider 解析器测试。
 * fixture 全部来自 2026-08-21 本机实测真实响应(见 docs/quota-research-*.md,已脱敏)。
 * 重点覆盖:正常解析、窗口动态标签、字段缺失/类型漂移的容错。
 */
import { describe, expect, it } from 'vitest'
import { parseWhamUsage } from './codex'
import { parseGrokBilling } from './grok'
import { parseKimiUsage, parseKimiUserinfo } from './kimi'
import { parseOpencodeGoUsage } from './opencode-go'
import { windowKeyAndLabel } from './http'

// ---------- Kimi ----------

// kimi web 本地服务 GET /api/v1/oauth/usage 实测响应
const KIMI_LOCAL_RESPONSE = {
  code: 0,
  msg: 'success',
  data: {
    kind: 'ok',
    summary: {
      window: { duration: 1, unit: 'week' },
      used: 15,
      limit: 100,
      reset_at: '2026-08-28T01:22:43Z'
    },
    limits: [
      {
        window: { duration: 5, unit: 'hour' },
        used: 3,
        limit: 100,
        reset_at: '2026-08-21T11:22:43Z'
      }
    ],
    extra_usage: null
  },
  request_id: '01M0HG2MHYQAFYH3S5F70XC9KM'
}

// 云端 GET /coding/v1/usages 实测响应(数值为字符串,detail 嵌套)
const KIMI_CLOUD_RESPONSE = {
  user: { userId: 'd8uu...', region: 'REGION_CN', membership: { level: 'LEVEL_INTERMEDIATE' } },
  usage: { limit: '100', used: '15', remaining: '85', resetTime: '2026-08-28T01:22:43Z' },
  limits: [
    {
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: { limit: '100', used: '3', remaining: '97', resetTime: '2026-08-21T11:22:43Z' }
    }
  ],
  parallel: { limit: '20' }
}

describe('parseKimiUsage', () => {
  it('解析本地服务响应:周窗口 + 5h 窗口', () => {
    const { windows, extras } = parseKimiUsage(KIMI_LOCAL_RESPONSE)
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({
      key: 'weekly',
      label: 'Weekly',
      usedPercent: 15,
      resetsAt: '2026-08-28T01:22:43Z'
    })
    expect(windows[1]).toMatchObject({ key: '5h', label: '5h', usedPercent: 3 })
    expect(extras).toHaveLength(0)
  })

  it('解析云端响应:字符串数值 + TIME_UNIT 枚举 + detail 嵌套', () => {
    const { windows } = parseKimiUsage(KIMI_CLOUD_RESPONSE)
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ key: 'weekly', usedPercent: 15 })
    // 300 分钟 = 5h
    expect(windows[1]).toMatchObject({ key: '5h', usedPercent: 3 })
  })

  it('extra_usage 开启时暴露加油包余额', () => {
    const json = {
      data: {
        summary: { window: { duration: 1, unit: 'week' }, used: 0, limit: 100, reset_at: null },
        limits: [],
        extra_usage: { balanceCents: 2500 }
      }
    }
    const { extras } = parseKimiUsage(json)
    expect(extras).toEqual([{ label: 'Extra usage', value: '¥25.00' }])
  })

  it('字段缺失/垃圾输入不抛异常', () => {
    expect(parseKimiUsage(null).windows).toHaveLength(0)
    expect(parseKimiUsage({}).windows).toHaveLength(0)
    expect(parseKimiUsage({ data: { kind: 'unauthenticated' } }).windows).toHaveLength(0)
    // limit 为 0 的窗口直接丢弃(除零保护)
    const { windows } = parseKimiUsage({
      data: { summary: { window: { unit: 'week' }, used: 5, limit: 0 }, limits: [] }
    })
    expect(windows).toHaveLength(0)
  })

  it('userinfo 提取订阅档位与 userId', () => {
    expect(parseKimiUserinfo({ data: { userLevelName: 'Allegretto', userId: 'u1' } })).toEqual({
      plan: 'Allegretto',
      userId: 'u1'
    })
    // 云端 /me 形如 data.user.userId
    expect(parseKimiUserinfo({ data: { user: { userId: 'u2' } } })).toEqual({
      plan: null,
      userId: 'u2'
    })
    expect(parseKimiUserinfo({})).toEqual({ plan: null, userId: null })
  })
})

// ---------- ChatGPT (Codex) ----------

// GET /backend-api/wham/usage 实测响应(Plus 账号:只有周窗口)
const WHAM_RESPONSE = {
  user_id: 'user...',
  account_id: 'bd6b...',
  plan_type: 'plus',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 30,
      limit_window_seconds: 604800,
      reset_after_seconds: 509076,
      reset_at: 1787804314
    },
    secondary_window: null
  },
  credits: { has_credits: true, unlimited: false, balance: '178.7548895000' }
}

describe('parseWhamUsage', () => {
  it('解析主窗口 + plan + credits', () => {
    const { plan, windows, extras } = parseWhamUsage(WHAM_RESPONSE)
    expect(plan).toBe('plus')
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      key: 'weekly',
      label: 'Weekly',
      usedPercent: 30,
      resetsAt: new Date(1787804314 * 1000).toISOString()
    })
    expect(extras).toEqual([{ label: 'Credits', value: '$178.75' }])
  })

  it('双窗口账号(5h primary + 周 secondary)都解析', () => {
    const json = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 41, limit_window_seconds: 18000, reset_at: 1783575368 },
        secondary_window: { used_percent: 40, limit_window_seconds: 10080 * 60, reset_at: 1783993448 }
      },
      credits: { has_credits: false, balance: null }
    }
    const { windows, extras } = parseWhamUsage(json)
    expect(windows.map((w) => w.key)).toEqual(['5h', 'weekly'])
    expect(extras).toHaveLength(0)
  })

  it('非常规窗口秒数动态生成标签', () => {
    expect(windowKeyAndLabel(18000)).toEqual({ key: '5h', label: '5h' })
    expect(windowKeyAndLabel(604800)).toEqual({ key: 'weekly', label: 'Weekly' })
    expect(windowKeyAndLabel(86400)).toEqual({ key: '1d', label: 'Daily' })
    expect(windowKeyAndLabel(259200)).toEqual({ key: '3d', label: '3d' })
    expect(windowKeyAndLabel(null).key).toBe('unknown')
  })

  it('垃圾输入不抛异常', () => {
    expect(parseWhamUsage(null).windows).toHaveLength(0)
    expect(parseWhamUsage('<html>cloudflare</html>').windows).toHaveLength(0)
  })
})

// ---------- OpenCode Go ----------

// GET /zen/go/v1/usage 实测响应
const OPENCODE_GO_RESPONSE = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-08-21T10:51:22.725Z' },
    weekly: { status: 'ok', percent: 20, resetsAt: '2026-08-24T00:00:00.725Z' },
    monthly: { status: 'ok', percent: 37, resetsAt: '2026-09-06T03:43:27.725Z' }
  }
}

describe('parseOpencodeGoUsage', () => {
  it('解析三个窗口', () => {
    const { windows } = parseOpencodeGoUsage(OPENCODE_GO_RESPONSE)
    expect(windows.map((w) => w.key)).toEqual(['5h', 'weekly', 'monthly'])
    expect(windows[2]).toMatchObject({ usedPercent: 37, resetsAt: '2026-09-06T03:43:27.725Z' })
  })

  it('窗口缺失时跳过,percent 非法时跳过', () => {
    const { windows } = parseOpencodeGoUsage({
      usage: { weekly: { percent: 12, resetsAt: '2026-08-24T00:00:00Z' }, monthly: { percent: 'x' } }
    })
    expect(windows.map((w) => w.key)).toEqual(['weekly'])
  })

  it('api.opencode.ai 的 200 "Not Found" 兜底文本不会产生窗口', () => {
    expect(parseOpencodeGoUsage('Not Found').windows).toHaveLength(0)
  })
})

// ---------- Grok ----------

// GET /v1/billing?format=credits 实测响应(本周已用满;proto3 的 0 值字段省略为 {})
const GROK_BILLING_RESPONSE = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-15T19:39:23+08:00',
      end: '2026-08-22T19:39:23+08:00'
    },
    creditUsagePercent: 100.0,
    onDemandCap: {},
    onDemandUsed: {},
    productUsage: [{ product: 'GrokBuild', usagePercent: 100.0 }],
    isUnifiedBillingUser: true,
    prepaidBalance: {},
    topUpMethod: 'TOP_UP_METHOD_SAVED_PAYMENT_METHOD',
    billingPeriodStart: '2026-08-15T19:39:23+08:00',
    billingPeriodEnd: '2026-08-22T19:39:23+08:00'
  }
}

describe('parseGrokBilling', () => {
  it('解析周窗口百分比 + 重置时间 + 分产品用量', () => {
    const { windows, extras } = parseGrokBilling(GROK_BILLING_RESPONSE)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      key: 'weekly',
      label: 'Weekly',
      usedPercent: 100,
      resetsAt: '2026-08-22T19:39:23+08:00'
    })
    expect(extras).toEqual([{ label: 'GrokBuild', value: '100%' }])
  })

  it('月度周期映射为 Monthly;无 currentPeriod 时回退 billingPeriodEnd', () => {
    const { windows } = parseGrokBilling({
      config: { creditUsagePercent: 42.5, billingPeriodEnd: '2026-09-01T00:00:00Z' }
    })
    expect(windows[0]).toMatchObject({
      key: 'credits',
      usedPercent: 42.5,
      resetsAt: '2026-09-01T00:00:00Z'
    })
    const monthly = parseGrokBilling({
      config: { creditUsagePercent: 10, currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', end: '2026-09-01T00:00:00Z' } }
    })
    expect(monthly.windows[0]).toMatchObject({ key: 'monthly', label: 'Monthly' })
  })

  it('prepaidBalance 大于 0 时展示 Extra credits;为 0(proto3 {})不展示', () => {
    const withBalance = parseGrokBilling({
      config: { creditUsagePercent: 5, prepaidBalance: { val: 1234 } }
    })
    expect(withBalance.extras).toContainEqual({ label: 'Extra credits', value: '$12.34' })
    const zero = parseGrokBilling({ config: { creditUsagePercent: 5, prepaidBalance: {} } })
    expect(zero.extras.some((e) => e.label === 'Extra credits')).toBe(false)
  })

  it('百分比钳制在 0–100;垃圾输入不抛异常', () => {
    expect(parseGrokBilling({ config: { creditUsagePercent: 130 } }).windows[0].usedPercent).toBe(100)
    expect(parseGrokBilling(null).windows).toHaveLength(0)
    expect(parseGrokBilling({}).windows).toHaveLength(0)
  })
})
