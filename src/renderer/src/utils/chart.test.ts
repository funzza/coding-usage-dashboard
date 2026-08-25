import { describe, expect, it } from 'vitest'
import { stackedAxisTooltip } from './chart'

/** 模拟 ECharts axis-trigger 传给 formatter 的参数结构 */
describe('stackedAxisTooltip', () => {
  it('renders rows + total for multi-series with numeric hour labels (24h chart)', () => {
    const html = stackedAxisTooltip([
      { marker: '<span>●</span>', seriesName: 'Input', value: 100, axisValueLabel: 14 },
      { marker: '<span>●</span>', seriesName: 'Output', value: 50, axisValueLabel: 14 }
    ])
    expect(html).toContain('14')
    expect(html).toContain('Input')
    expect(html).toContain('Output')
    expect(html).toContain('Total')
    expect(html).toContain('150')
  })

  it('renders date label series without total dup (trend chart)', () => {
    const html = stackedAxisTooltip([
      { marker: 'm', seriesName: 'Kimi (WSL)', value: 12345, axisValueLabel: '08-21' },
      { marker: 'm', seriesName: 'Claude', value: 100, axisValueLabel: '08-21' }
    ])
    expect(html).toContain('08-21')
    expect(html).toContain('Kimi (WSL)')
    expect(html).toContain('Total')
  })

  it('single series has no total row', () => {
    const html = stackedAxisTooltip([{ marker: 'm', seriesName: 'gpt-5.5', value: 5, axisValueLabel: 'Aug' }])
    expect(html).toContain('gpt-5.5')
    expect(html).not.toContain('Total')
  })

  it('tolerates missing/odd fields without throwing', () => {
    expect(() =>
      stackedAxisTooltip([{ marker: 'm', seriesName: undefined as unknown as string, value: 0, axisValueLabel: 3 }])
    ).not.toThrow()
    expect(stackedAxisTooltip([])).toBe('')
  })
})
