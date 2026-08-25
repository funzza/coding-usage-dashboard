import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptDailyReport, adaptSessionReport } from '../ccusage/adapter'
import { mergeDailyIntoSnapshot, summarizeDaily } from '../../shared/usage-model'
import { agentKeyOf, parseAgentKey } from '../../shared/agents'
import type { EngineInfo } from '../../shared/usage-model'
import type { CcusageDailyReport, CcusageSessionReport } from '../ccusage/types'
import { markWslDaily, markWslSessions } from './adapter'

const engine: EngineInfo = { version: '20.0.20', path: '/usr/local/bin/ccusage' }

const dailyFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/ccusage-daily-by-agent.json'), 'utf-8')
) as CcusageDailyReport

const sessionFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/ccusage-session-by-agent.json'), 'utf-8')
) as CcusageSessionReport

// fixture 最后一天为 2026-08-21
const now = new Date(2026, 7, 21, 12, 0, 0)

describe('markWslDaily (real fixture)', () => {
  const snapshot = adaptDailyReport(dailyFixture, engine, now)
  const marked = markWslDaily(snapshot.daily)

  it('marks every agent in every day with origin wsl and keeps names unchanged', () => {
    expect(marked.length).toBe(snapshot.daily.length)
    for (let i = 0; i < snapshot.daily.length; i++) {
      expect(marked[i].agents.length).toBe(snapshot.daily[i].agents.length)
      for (let j = 0; j < snapshot.daily[i].agents.length; j++) {
        expect(marked[i].agents[j].agent).toBe(snapshot.daily[i].agents[j].agent)
        expect(marked[i].agents[j].origin).toBe('wsl')
      }
    }
  })

  it('keeps every numeric field identical', () => {
    for (let i = 0; i < snapshot.daily.length; i++) {
      const before = snapshot.daily[i]
      const after = marked[i]
      expect(after.date).toBe(before.date)
      expect(after.totalTokens).toBe(before.totalTokens)
      expect(after.totalCost).toBe(before.totalCost)
      expect(after.agents.length).toBe(before.agents.length)
    }
  })

  it('does not mutate the input daily', () => {
    const before = JSON.stringify(snapshot.daily)
    markWslDaily(snapshot.daily)
    expect(JSON.stringify(snapshot.daily)).toBe(before)
  })

  it('merged snapshot keeps same-name agents separate via origin (no double counting)', () => {
    const merged = adaptDailyReport(dailyFixture, engine, now)
    mergeDailyIntoSnapshot(merged, marked, now)

    // 同名 agent 两侧并存:claude(windows)与 claude(wsl)是两个条目
    const winClaude = merged.agents.find((a) => a.agent === 'claude' && (a.origin ?? 'windows') === 'windows')
    const wslClaude = merged.agents.find((a) => a.agent === 'claude' && a.origin === 'wsl')
    expect(winClaude).toBeTruthy()
    expect(wslClaude).toBeTruthy()
    expect(winClaude!.totalTokens).toBe(wslClaude!.totalTokens)

    // 合并 = 同一份数据两遍(Windows 原始 + WSL 标注),总量翻倍
    expect(merged.totals.totalTokens).toBe(snapshot.totals.totalTokens * 2)
  })

  it('agentKeyOf round-trips through parseAgentKey', () => {
    expect(agentKeyOf({ agent: 'claude', origin: 'wsl' })).toBe('claude@wsl')
    expect(agentKeyOf({ agent: 'claude' })).toBe('claude')
    expect(parseAgentKey('claude@wsl')).toEqual({ agent: 'claude', origin: 'wsl' })
    expect(parseAgentKey('claude')).toEqual({ agent: 'claude', origin: 'windows' })
  })
})

describe('markWslSessions (real fixture)', () => {
  const report = adaptSessionReport(sessionFixture, engine, now)
  const marked = markWslSessions(report.sessions)

  it('marks origin while keeping ids, names and timestamps', () => {
    expect(marked.length).toBe(report.sessions.length)
    for (let i = 0; i < report.sessions.length; i++) {
      expect(marked[i].agent).toBe(report.sessions[i].agent)
      expect(marked[i].origin).toBe('wsl')
      expect(marked[i].id).toBe(report.sessions[i].id)
      expect(marked[i].lastActivity).toBe(report.sessions[i].lastActivity)
      expect(marked[i].totalTokens).toBe(report.sessions[i].totalTokens)
    }
  })

  it('does not mutate the input sessions', () => {
    const before = JSON.stringify(report.sessions)
    markWslSessions(report.sessions)
    expect(JSON.stringify(report.sessions)).toBe(before)
  })
})

describe('end-to-end shape: marked wsl daily summarizes cleanly', () => {
  it('summarizes with origin-aware agent entries', () => {
    const snapshot = adaptDailyReport(dailyFixture, engine, now)
    const marked = markWslDaily(snapshot.daily)
    const summary = summarizeDaily(marked, now)
    expect(summary.totals.totalTokens).toBe(snapshot.totals.totalTokens)
    // windows 侧条目不复存在:wsl 侧全部带 origin
    expect(summary.agents.every((a) => a.origin === 'wsl')).toBe(true)
    expect(summary.agents.map((a) => agentKeyOf(a))).toContain('claude@wsl')
  })
})
