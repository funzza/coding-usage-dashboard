import { getSkin } from '../../../shared/skins'
import { activeSkinId } from './skin'
import { agentKeyOf, displayAgentKey, parseAgentKey } from '../../../shared/agents'
import type { UsageOrigin } from '../../../shared/agents'

export { agentKeyOf, parseAgentKey, displayAgentKey }

/**
 * agent/model 配色:按 key 稳定取色,且同一皮肤内全局互不重复。
 * 实现:每个皮肤维护一个"已分配槽位"注册表——key 的基准槽位由 hash 决定,
 * 若已被其他 key 占用则向后线性探测下一个空槽(撞色即错开)。
 * - 稳定:同一 key 在本会话内颜色不变(跨页面/图表/明细一致)
 * - 去重:色板容量(16)内任意两个不同 key 颜色必不同,图例/悬浮球/明细不再撞色
 * - 换肤:各皮肤独立注册,切换回来时同 key 恢复该皮肤下的原色
 * 读取 activeSkinId 让模板/图表在换肤时自动重渲染(canvas 场景本就在 computed 里 touch)。
 * key 即身份(windows 裸名 / wsl 带 @wsl)——同一 agent 两侧天然分色,且与 quota 卡片对齐。
 */
const registryBySkin = new Map<string, Map<string, string>>()
const usedSlotsBySkin = new Map<string, Set<number>>()

function hashKey(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return hash
}

function colorFor(skinId: string, palette: string[], key: string): string {
  let assigned = registryBySkin.get(skinId)
  let used = usedSlotsBySkin.get(skinId)
  if (!assigned || !used) {
    assigned = new Map()
    used = new Set()
    registryBySkin.set(skinId, assigned)
    usedSlotsBySkin.set(skinId, used)
  }
  const existing = assigned.get(key)
  if (existing) return existing
  const len = palette.length
  const base = hashKey(key) % len
  let idx = base
  let probe = 0
  // 线性探测:跳过已被占用的槽位,保证本次分配与其他 key 不撞色
  while (probe < len && used.has(idx)) {
    idx = (base + ++probe) % len
  }
  if (probe < len) used.add(idx)
  // 色板耗尽(key 数超过容量)时允许重复,回退基准槽位
  const color = palette[idx] ?? palette[base]
  assigned.set(key, color)
  return color
}

export function agentColor(key: string): string {
  const skin = getSkin(activeSkinId.value)
  return colorFor(skin.id, skin.series, key)
}

/** 任意系列(agent/model)稳定取色 */
export const seriesColor = agentColor

/** quota 账号 → 与 usage 侧同口径的 agentKey(配色/交叉视图对齐用) */
export function quotaAgentKey(agent: string, origin?: UsageOrigin): string {
  return agentKeyOf({ agent, origin })
}
