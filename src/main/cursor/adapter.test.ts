/**
 * Cursor 用量 CSV 解析与归一化测试。
 * fixture 来自 2026-08-31 本机实测真实响应(见 docs/quota-research-cursor.md,已脱敏)。
 */
import { describe, expect, it } from 'vitest'
import { adaptCursorRows, parseCursorUsageCsv } from './adapter'
import { localDateString } from '../../shared/usage-model'

const CSV = [
  'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
  '"2026-08-31T11:47:23.054Z","","","Included","cursor-grok-4.6-xhigh-fast","No","0","822654","11350272","124288","12297214","Included"',
  '"2026-08-31T11:46:13.842Z","","","Included","cursor-grok-4.6-xhigh-fast","No","0","99616","148480","2215","250311","Included"',
  '"2026-06-26T05:46:09.111Z","","","free","auto","No","0","56321","361376","2559","420256","0.18"'
].join('\n')

describe('parseCursorUsageCsv', () => {
  it('解析逐事件行并映射 token 字段', () => {
    const rows = parseCursorUsageCsv(CSV)
    expect(rows).not.toBeNull()
    expect(rows).toHaveLength(3)

    const first = rows![0]
    // Date 是 UTC ISO,按本地时区落桶
    expect(first.day).toBe(localDateString(new Date('2026-08-31T11:47:23.054Z')))
    expect(first.model).toBe('cursor-grok-4.6-xhigh-fast')
    expect(first.inputTokens).toBe(822654)
    expect(first.cacheReadTokens).toBe(11350272)
    expect(first.outputTokens).toBe(124288)
    expect(first.cacheCreationTokens).toBe(0) // Input (w/ Cache Write)
    expect(first.totalTokens).toBe(12297214) // 上报值优先
    expect(first.totalCost).toBe(0) // 'Included' 非数值

    // 数值 Cost 解析为美元
    expect(rows![2].totalCost).toBe(0.18)
  })

  it('字段缺失/漂移返回 null', () => {
    const broken = 'Date,Model,Total Tokens\n"2026-08-31T00:00:00Z","m","1"'
    expect(parseCursorUsageCsv(broken)).toBeNull()
  })

  it('行字段数对不上返回 null', () => {
    const malformed = CSV.split('\n')[0] + '\n"2026-08-31T00:00:00Z","m","1"'
    expect(parseCursorUsageCsv(malformed)).toBeNull()
  })

  it('只有表头(无事件)返回空数组', () => {
    expect(parseCursorUsageCsv(CSV.split('\n')[0])).toEqual([])
  })

  it('空文本返回 null', () => {
    expect(parseCursorUsageCsv('')).toBeNull()
  })
})

describe('adaptCursorRows', () => {
  it('按天×模型聚合为 DailyUsage[],agent 固定 cursor', () => {
    const rows = parseCursorUsageCsv(CSV)!
    const daily = adaptCursorRows(rows)
    expect(daily).toHaveLength(2)

    const day = daily.find((d) => d.date === localDateString(new Date('2026-08-31T11:47:23.054Z')))!
    expect(day.agents.map((a) => a.agent)).toEqual(['cursor'])
    // 同一模型两行合并
    expect(day.inputTokens).toBe(822654 + 99616)
    expect(day.outputTokens).toBe(124288 + 2215)
    expect(day.cacheReadTokens).toBe(11350272 + 148480)
    expect(day.cacheCreationTokens).toBe(0)
    expect(day.totalTokens).toBe(12297214 + 250311)
    expect(day.agents[0].models).toHaveLength(1)
    expect(day.agents[0].models[0].model).toBe('cursor-grok-4.6-xhigh-fast')
  })

  it('日期升序', () => {
    const daily = adaptCursorRows(parseCursorUsageCsv(CSV)!)
    const dates = daily.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)
  })
})
