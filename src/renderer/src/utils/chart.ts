import { formatTokens } from '../../../shared/format'
import { cssToken } from './skin'

/** ECharts axis-trigger tooltip 的单个系列参数(只取我们用到的字段) */
interface TooltipParam {
  marker: string
  seriesName: string
  value: number
  /** 系列实际柱色(带色名字的素材) */
  color?: string
  axisValueLabel?: string
  name?: string
}

function escapeHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 堆叠柱状图的 axis tooltip:X 轴标题 + 各系列明细 + 总和行。
 * 单系列时不重复显示总和(总和即该系列);多系列在分隔线下加粗 Total。
 * 两个柱状图(趋势/24h 活动)共用,保证口径一致。
 * 注意 x 轴标签可能是数字(24h 图的 0-23),一律 String 化后再拼接,
 * formatter 抛异常会被 ECharts 静默吞掉、tooltip 直接消失。
 */
export function stackedAxisTooltip(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as TooltipParam[]
  if (list.length === 0) return ''
  const title = String(list[0].axisValueLabel ?? list[0].name ?? '')
  // 堆叠多系列:值为 0 的系列没有可见柱段,悬浮展示属于噪音,直接过滤;
  // 单系列(agent/model 详情页)保留 0,让用户看到确切的空值。
  const entries = list.length === 1 ? list : list.filter((p) => (Number(p.value) || 0) > 0)
  // 多系列才显示 Total;全为 0(空柱)时也显示,给出确切的零值总和
  const showTotal = entries.length > 1 || entries.length === 0
  const total =
    entries.length === 0 ? 0 : entries.reduce((s, p) => s + (Number(p.value) || 0), 0)
  const lines: string[] = []
  // 头部一行:日期在左,Total 右对齐加粗突出,不与明细挤在底部
  const head = title ? `<span style="font-weight:600">${escapeHtml(title)}</span>` : ''
  const totalPart = showTotal
    ? `<span style="margin-left:auto;font-weight:700;color:${cssToken(
        '--text-bright',
        '#ffffff'
      )}">Total&nbsp;&nbsp;${formatTokens(total)} (${total.toLocaleString()})</span>`
    : ''
  if (head || totalPart) {
    lines.push(
      `<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:${
        entries.length ? 2 : 0
      }px">${head}${totalPart}</div>`
    )
  }
  for (const p of entries) {
    const v = Number(p.value) || 0
    const name = escapeHtml(p.seriesName ?? '')
    // 系列名用柱色着色,与图例/柱段颜色一一对应,便于快速定位;
    // 数值保持默认色加粗,强调度留给 Total
    const colorStyle = p.color ? ` style="color:${escapeHtml(p.color)}"` : ''
    lines.push(
      `${p.marker ?? ''} <span${colorStyle}>${name}</span>&nbsp;&nbsp;<b>${formatTokens(v)} (${v.toLocaleString()})</b>`
    )
  }
  return lines.join('<br/>')
}
