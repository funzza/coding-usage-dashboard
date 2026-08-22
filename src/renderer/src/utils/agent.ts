import { getSkin } from '../../../shared/skins'
import { activeSkinId } from './skin'

/** agent 配色:取当前皮肤的 series 调色板,按 agent 名稳定取色。
 * 读取 activeSkinId 让模板/图表在换肤时自动重渲染(canvas 场景本就在 computed 里 touch) */
export function agentColor(agent: string): string {
  const palette = getSkin(activeSkinId.value).series
  let hash = 0
  for (let i = 0; i < agent.length; i++) {
    hash = (hash * 31 + agent.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

/** 任意系列(agent/model)稳定取色 */
export const seriesColor = agentColor

/** 品牌名大小写特例(默认仅首字母大写) */
const DISPLAY_NAMES: Record<string, string> = {
  zcode: 'ZCode',
  dsh: 'DSH',
  qoder: 'Qoder'
}

export function displayAgentName(agent: string): string {
  return DISPLAY_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1)
}
