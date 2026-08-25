import type { DailyUsage, SessionUsage } from '../../shared/usage-model'

/** Settings 状态行/数据源注册用的源名 */
export const WSL_CCUSAGE_SOURCE = 'wsl-ccusage'

/**
 * 给 daily 数据中的所有 agent 标注 origin: 'wsl'。
 * agent 名保持本名(claude/zcode...),与 Windows 侧同名 agent 的区分由
 * 结构化 origin 字段承担(合并键 = agentKeyOf,如 `claude@wsl`)。
 * 产出全新 day/agent 对象(models 数组防御性共享,merge 侧会自行拷贝),
 * 不 mutate 输入;数值与结构逐字段保持不变。
 */
export function markWslDaily(daily: DailyUsage[]): DailyUsage[] {
  return daily.map((day) => ({
    ...day,
    agents: day.agents.map((a) => ({ ...a, origin: 'wsl' as const }))
  }))
}

/** 给 session 列表标注 origin: 'wsl',语义同 markWslDaily。 */
export function markWslSessions(sessions: SessionUsage[]): SessionUsage[] {
  return sessions.map((s) => ({ ...s, origin: 'wsl' as const }))
}
