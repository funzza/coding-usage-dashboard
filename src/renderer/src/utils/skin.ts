import { ref } from 'vue'
import { applySkin, getSkin, loadStoredSkinId } from '../../../shared/skins'

/**
 * renderer 侧的皮肤状态:
 * - activeSkinId 是响应式的,echarts 等 JS 取色的 computed 里 touch 它即可在换肤时重建 option
 * - 纯 CSS 变量取色的地方(inline style var(--xxx)、scoped style)无需经过这里,换肤自动生效
 */
export const activeSkinId = ref(loadStoredSkinId())

/** 无边框窗口右上角 caption 按钮(min/max/close)的配色随皮肤走;悬浮球窗口调用时 main 只改主窗口,无害 */
export function syncTitlebarOverlay(id: string): void {
  const tokens = getSkin(id).tokens
  const color = tokens['--bg']
  const symbolColor = tokens['--text-dim']
  if (color && symbolColor && window.usageApi?.setTitlebarOverlay) {
    void window.usageApi.setTitlebarOverlay(color, symbolColor)
  }
}

export function setSkin(id: string): void {
  applySkin(id)
  activeSkinId.value = id
  syncTitlebarOverlay(id)
}

/** 解析当前皮肤的 CSS 变量值(供 canvas/echarts 等无法直接消费 var() 的场景) */
export function cssToken(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** 各皮肤的 echarts 全局字体(Paper 衬线 / Blueprint 等宽);undefined = echarts 默认 */
export function chartFontFamily(): string | undefined {
  const id = activeSkinId.value
  if (id === 'paper') return "Georgia, 'Palatino Linotype', 'Times New Roman', serif"
  if (id === 'blueprint') return "Consolas, 'Cascadia Mono', 'Courier New', monospace"
  return undefined
}

/** Neon 皮肤的图形发光(echarts shadow 属性);其余皮肤返回空对象 */
export function neonShadow(color: string): { shadowBlur?: number; shadowColor?: string } {
  return activeSkinId.value === 'neon' ? { shadowBlur: 10, shadowColor: color } : {}
}
