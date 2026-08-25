/**
 * 真实环境集成测试:定位 WSL 内 ccusage → 执行真实 JSON 命令 → 采集 → 合并。
 * 依赖本机 WSL(默认发行版)内已安装 ccusage;未安装 WSL / 未装 ccusage 时自动跳过。
 */
import { describe, expect, it } from 'vitest'
import { adaptDailyReport } from '../ccusage/adapter'
import { mergeDailyIntoSnapshot } from '../../shared/usage-model'
import type { EngineInfo } from '../../shared/usage-model'
import { locateWslCcusage } from './locator'
import { collectWslCcusageDaily, collectWslCcusageSessions } from './index'
import { agentKeyOf } from '../../shared/agents'

const engine: EngineInfo = { version: 'test', path: 'C:\\ccusage.cmd' }

describe('wsl ccusage real environment integration', () => {
  it('locates wsl ccusage, collects tagged daily, merges into snapshot', async () => {
    const detect = await locateWslCcusage()
    if (!detect.found) {
      console.warn(`wsl ccusage unavailable (${detect.reason ?? 'not found'}), skipping integration test`)
      return
    }

    // 定位结果必须是 WSL 原生路径:绝对路径且不在 /mnt 挂载下
    expect(detect.path).toMatch(/^\//)
    expect(detect.path).not.toMatch(/^\/mnt\//)
    expect(detect.version).toMatch(/^\d+\.\d+\.\d+/)

    const { daily, status } = await collectWslCcusageDaily(detect)
    expect(status.state).toBe('ok')
    if (!daily || daily.length === 0) {
      // WSL 内有 ccusage 但尚无任何用量数据:链路已通,无数据可断言
      console.warn('wsl ccusage has no usage data yet, merge assertions skipped')
      return
    }

    // 所有 agent 必须标注 origin wsl(agent 名保持本名),与 Windows 侧同名 agent 防双算
    expect(daily.length).toBeGreaterThan(0)
    for (const day of daily) {
      for (const a of day.agents) {
        expect(a.origin).toBe('wsl')
        expect(agentKeyOf(a).endsWith('@wsl')).toBe(true)
      }
    }

    // 合并:WSL agent 与不存在的 Windows 同名 agent 不互相覆盖
    const snapshot = adaptDailyReport(
      { daily: [] },
      engine,
      new Date()
    )
    mergeDailyIntoSnapshot(snapshot, daily)
    expect(snapshot.daily.length).toBe(daily.length)
    expect(snapshot.totals.totalTokens).toBeGreaterThan(0)
  }, 180_000)

  it('collects tagged sessions from wsl ccusage', async () => {
    const detect = await locateWslCcusage()
    if (!detect.found) {
      console.warn(`wsl ccusage unavailable (${detect.reason ?? 'not found'}), skipping integration test`)
      return
    }
    const { sessions, status } = await collectWslCcusageSessions(detect)
    expect(status.state).toBe('ok')
    if (!sessions || sessions.length === 0) {
      console.warn('wsl ccusage has no session data yet, assertions skipped')
      return
    }
    for (const s of sessions) {
      expect(s.origin).toBe('wsl')
      expect(s.id).toBeTruthy()
    }
  }, 180_000)
})
