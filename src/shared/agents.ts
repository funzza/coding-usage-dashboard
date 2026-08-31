/**
 * agent 身份工具:结构化 (agent, origin) 与序列化 key 的互转、显示名。
 * main 与 renderer 共用(托盘菜单与前端图表用同一显示口径)。
 *
 * key 编码:windows 侧为裸名(`kimi`),wsl 侧追加 `@wsl`(`kimi@wsl`)。
 * key 用于 Map 合并、ECharts 系列名、路由参数 —— 这些场景天然是 string;
 * 语义判断(筛选/合并)应优先用结构化 origin 字段,key 只是序列化形式。
 */

export type UsageOrigin = 'windows' | 'wsl'

const WSL_KEY_SUFFIX = '@wsl'

export function agentKeyOf(a: { agent: string; origin?: UsageOrigin }): string {
  return a.origin === 'wsl' ? a.agent + WSL_KEY_SUFFIX : a.agent
}

export function parseAgentKey(key: string): { agent: string; origin: UsageOrigin } {
  return key.endsWith(WSL_KEY_SUFFIX)
    ? { agent: key.slice(0, -WSL_KEY_SUFFIX.length), origin: 'wsl' }
    : { agent: key, origin: 'windows' }
}

/** 品牌名大小写特例(默认仅首字母大写) */
const DISPLAY_NAMES: Record<string, string> = {
  zcode: 'ZCode',
  dsh: 'DSH',
  qoder: 'Qoder',
  cursor: 'Cursor'
}

/** agentKey → 展示名:kimi → "Kimi",kimi@wsl → "Kimi (WSL)",zcode@wsl → "ZCode (WSL)" */
export function displayAgentKey(key: string): string {
  const { agent, origin } = parseAgentKey(key)
  const base = DISPLAY_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1)
  return origin === 'wsl' ? `${base} (WSL)` : base
}

/** 数据源状态键(snapshot.sources 的键)→ Settings 状态行的显示名 */
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  zcode: 'ZCode',
  dsh: 'DSH',
  qoder: 'Qoder',
  cursor: 'Cursor',
  'wsl-ccusage': 'WSL ccusage',
  'zcode-wsl': 'ZCode (WSL)',
  'dsh-wsl': 'DSH (WSL)'
}

export function displaySourceName(name: string): string {
  return SOURCE_DISPLAY_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}
