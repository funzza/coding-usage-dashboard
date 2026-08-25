/**
 * 悬浮球外观配置的共享定义(main / preload / renderer 三方都要用,不放 main/float
 * 以免 renderer 打包时把 electron 依赖拖进来)
 */

/** 折叠态三档尺寸(px) */
export const FLOAT_SIZE_PX = { s: 48, m: 64, l: 80 } as const

export type FloatSize = keyof typeof FLOAT_SIZE_PX
export type FloatAnimation = 'lively' | 'calm'
export type FloatColorMode = 'adaptive' | 'fixed'

/**
 * 折叠态形态:
 * - ball: 经典用量环——填充 = 今日 tokens / 历史 P90,配色档位随分位
 * - ring: 配额环——填充 = 最紧张订阅窗口的消耗百分比,配色随阈值,
 *         ≥90% 时环体脉冲呼吸(预警不上系统通知,只在环上表现)
 */
export type FloatShape = 'ball' | 'ring'

/** 悬浮球外观配置,实时生效 */
export interface FloatConfig {
  size: FloatSize
  /** 只作用于球体(展开面板保持不透明) */
  opacity: number
  animation: FloatAnimation
  colorMode: FloatColorMode
  shape: FloatShape
}

export const DEFAULT_FLOAT_CONFIG: FloatConfig = {
  size: 'm',
  opacity: 1,
  animation: 'lively',
  colorMode: 'adaptive',
  shape: 'ball'
}
