/**
 * 真实环境集成测试:定位本机 ccusage → 执行真实 JSON 命令 → 适配。
 * 依赖系统已全局安装 ccusage;未安装时自动跳过。
 */
import { describe, expect, it } from 'vitest'
import { adaptDailyReport } from './adapter'
import { locateCcusage } from './locator'
import { runCcusageJson } from './runner'

describe('ccusage real environment integration', () => {
  it('locates ccusage, runs daily --json --by-agent, adapts snapshot', async () => {
    const detect = await locateCcusage()
    if (!detect.found) {
      console.warn('ccusage not installed on this machine, skipping integration test')
      return
    }
    expect(detect.path).toBeTruthy()
    expect(detect.version).toMatch(/^\d+\.\d+\.\d+/)

    // 本机 ccusage 单次调用实测可达 ~98s,runner 默认 60s 会超时,显式放宽
    const raw = await runCcusageJson(detect.path!, ['daily', '--json', '--by-agent'], 150_000)
    const snapshot = adaptDailyReport(raw, { version: detect.version!, path: detect.path! })
    expect(snapshot.daily.length).toBeGreaterThan(0)
    expect(snapshot.totals.totalTokens).toBeGreaterThan(0)
    expect(snapshot.agents.length).toBeGreaterThan(0)
  }, 180_000)
})
