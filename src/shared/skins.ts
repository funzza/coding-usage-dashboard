/**
 * 皮肤(skin)注册表:皮肤不只是换色,tokens 是写到 :root 的 CSS 变量映射,
 * data-skin 属性供各皮肤用 `[data-skin='xxx']` 选择器覆写布局/密度/图标。
 * 主窗口与悬浮球窗口共享同一 session 的 localStorage,皮肤选择天然同步。
 *
 * 新增皮肤:在 SKINS 里加一个 descriptor,再按需写 data-skin 覆写样式即可。
 */

export interface SkinDescriptor {
  id: string
  name: string
  description: string
  /** CSS 变量映射(--xxx: value),applySkin 时整体写到 documentElement */
  tokens: Record<string, string>
  /** Settings 皮肤列表里展示的代表色点(4-5 个) */
  swatches: string[]
  /** agent/model 系列调色板(图表、圆点),由 renderer 端按 key 稳定分配、全局去重 */
  series: string[]
}

/** localStorage key;两窗口共享 */
const STORAGE_KEY = 'usage-dashboard:skin'

/** Classic:改造前的原始深色主题,视觉必须保持与现状一致 */
const CLASSIC_TOKENS: Record<string, string> = {
  '--bg': '#0f1115',
  '--panel': '#171a21',
  '--panel-sunken': '#10131a',
  '--border': '#232833',
  '--border-strong': '#2e3542',
  '--divider': '#1e232d',
  '--track': '#1c212b',
  '--hover-bg': '#171a21',
  '--active-bg': '#1c2230',
  '--seg-active-bg': '#2a3242',
  '--seg-active-text': '#e6e8eb',
  '--text': '#e6e8eb',
  '--text-bright': '#e6e8eb',
  '--text-strong': '#e6e8eb',
  '--text-dim': '#9aa3af',
  '--text-mute': '#6b7280',
  '--text-faint': '#4b5563',
  '--accent': '#5b8ff9',
  '--accent-hover': '#6f9bfa',
  '--brand-violet': '#7c6cf8',
  '--green': '#5ad8a6',
  '--amber': '#f6bd16',
  '--red': '#f87171',
  '--warning-bg': '#2a2118',
  '--warning-border': '#4a3a24',
  '--warning-text': '#fbbf24',
  '--stale-border': '#3a3040',
  '--spinner-track': '#3a4356',
  '--comp-input': '#5b8ff9',
  '--comp-output': '#5ad8a6',
  '--comp-cache-creation': '#f6bd16',
  '--comp-cache-read': '#9270ca',
  '--quota-fill': '#97a1b5',
  '--chart-grid': '#1e232d',
  '--tooltip-bg': '#1e232d',
  '--tooltip-border': '#2e3542',
  '--float-panel': '#171a21'
}

/** Focus:mockups/a-focus.html 的去盒子化沉静主题 */
const FOCUS_TOKENS: Record<string, string> = {
  '--bg': '#0d0f13',
  '--panel': 'rgba(255,255,255,0.03)',
  '--panel-sunken': 'transparent',
  '--border': 'rgba(255,255,255,0.055)',
  '--border-strong': 'rgba(255,255,255,0.10)',
  '--divider': 'rgba(255,255,255,0.05)',
  '--track': 'rgba(255,255,255,0.07)',
  '--hover-bg': 'rgba(255,255,255,0.03)',
  '--active-bg': 'rgba(255,255,255,0.045)',
  '--seg-active-bg': 'rgba(110,139,255,0.16)',
  '--seg-active-text': '#c9d3ff',
  '--text': '#e7eaf1',
  '--text-bright': '#f2f4f8',
  '--text-strong': '#dfe3ec',
  '--text-dim': '#8b93a1',
  '--text-mute': '#565f6e',
  '--text-faint': '#454c59',
  '--accent': '#6e8bff',
  '--accent-hover': '#8aa2ff',
  '--brand-violet': '#6e8bff',
  '--green': '#5ad8a6',
  '--amber': '#f6bd16',
  '--red': '#f87171',
  '--warning-bg': 'rgba(251,191,36,0.08)',
  '--warning-border': 'rgba(251,191,36,0.22)',
  '--warning-text': '#fbbf24',
  '--stale-border': 'rgba(248,113,113,0.25)',
  '--spinner-track': 'rgba(255,255,255,0.14)',
  '--comp-input': '#5b8ff9',
  '--comp-output': '#5ad8a6',
  '--comp-cache-creation': '#f6bd16',
  '--comp-cache-read': '#b175f8',
  '--quota-fill': '#97a1b5',
  '--chart-grid': 'rgba(255,255,255,0.05)',
  '--tooltip-bg': '#171a20',
  '--tooltip-border': 'rgba(255,255,255,0.08)',
  '--float-panel': '#171a20'
}

/** HSL → hex(标准换算公式,输出 #rrggbb) */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * 黄金角均匀分布的系列色:色相步进 137.508°(黄金角),相邻颜色色相差最大化,
 * 任意两个相邻槽位的颜色都不会相近;容量 32,覆盖 25+ 模型的场景仍不撞色。
 * 每套皮肤用不同的饱和/亮度调子,保证该皮肤背景下可读。
 */
function goldenSeries(count: number, s: number, l: number, startHue = 0): string[] {
  return Array.from({ length: count }, (_, i) => hslToHex((startHue + i * 137.508) % 360, s, l))
}

/** Mono 专用:黑白灰交替深浅(偶位深、奇位浅),相邻对比最大化;黑白主题本身无色相 */
function monoSeries(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return hslToHex(0, 0, i % 2 === 0 ? 0.08 + t * 0.34 : 0.92 - t * 0.34)
  })
}

/** 默认系列调色板(classic/focus 共用):深色背景下中等饱和/亮度,色彩鲜明 */
const DEFAULT_SERIES = goldenSeries(32, 0.68, 0.6)

/** Paper:mockups/skin-paper.html 的暖纸亮色编辑排版主题 */
const PAPER_TOKENS: Record<string, string> = {
  '--bg': '#f4f0e6',
  '--panel': '#fbf8f0',
  '--panel-sunken': '#efe9da',
  '--border': '#ddd5c0',
  '--border-strong': '#c6bda4',
  '--divider': '#e4ddc9',
  '--track': '#e7e0cd',
  '--hover-bg': '#f0ead9',
  '--active-bg': '#eae2cd',
  '--seg-active-bg': '#23201a',
  '--seg-active-text': '#fbf8f0',
  '--text': '#23201a',
  '--text-bright': '#17140f',
  '--text-strong': '#23201a',
  '--text-dim': '#6f695a',
  '--text-mute': '#a49b85',
  '--text-faint': '#c0b8a2',
  '--accent': '#b8542e',
  '--accent-hover': '#a04625',
  '--brand-violet': '#9b7bb8',
  '--green': '#5d7341',
  '--amber': '#c2953a',
  '--red': '#b03a2a',
  '--warning-bg': '#f5e8d3',
  '--warning-border': '#dcc493',
  '--warning-text': '#8a5c14',
  '--stale-border': '#d8b8ab',
  '--spinner-track': '#d8d0ba',
  '--comp-input': '#4a6580',
  '--comp-output': '#5d7341',
  '--comp-cache-creation': '#c2953a',
  '--comp-cache-read': '#9b7bb8',
  '--quota-fill': '#23201a',
  '--chart-grid': '#e2dac6',
  '--tooltip-bg': '#fbf8f0',
  '--tooltip-border': '#c6bda4',
  '--float-panel': '#fbf8f0'
}

/** Mono:mockups/skin-mono.html 的瑞士黑白排印主题,红色只给超限 */
const MONO_TOKENS: Record<string, string> = {
  '--bg': '#ffffff',
  '--panel': '#ffffff',
  '--panel-sunken': '#f5f5f5',
  '--border': '#0a0a0a',
  '--border-strong': '#0a0a0a',
  '--divider': '#e4e4e4',
  '--track': '#efefef',
  '--hover-bg': '#f3f3f3',
  '--active-bg': '#eaeaea',
  '--seg-active-bg': '#0a0a0a',
  '--seg-active-text': '#ffffff',
  '--text': '#0a0a0a',
  '--text-bright': '#000000',
  '--text-strong': '#0a0a0a',
  '--text-dim': '#5c5c5c',
  '--text-mute': '#8a8a8a',
  '--text-faint': '#b8b8b8',
  '--accent': '#0a0a0a',
  '--accent-hover': '#333333',
  '--brand-violet': '#4d4d4d',
  '--green': '#4d4d4d',
  '--amber': '#5c5c5c',
  '--red': '#e1352b',
  '--warning-bg': '#ffffff',
  '--warning-border': '#e1352b',
  '--warning-text': '#e1352b',
  '--stale-border': '#e1352b',
  '--spinner-track': '#d5d5d5',
  '--comp-input': '#0a0a0a',
  '--comp-output': '#8a8a8a',
  '--comp-cache-creation': '#5c5c5c',
  '--comp-cache-read': '#c9c9c9',
  '--quota-fill': '#0a0a0a',
  '--chart-grid': '#e4e4e4',
  '--tooltip-bg': '#ffffff',
  '--tooltip-border': '#0a0a0a',
  '--float-panel': '#ffffff'
}

/** Neon:mockups/skin-neon.html 的深紫黑霓虹发光主题 */
const NEON_TOKENS: Record<string, string> = {
  '--bg': '#06060f',
  '--panel': 'rgba(148,120,255,0.05)',
  '--panel-sunken': 'rgba(0,0,0,0.28)',
  '--border': 'rgba(0,229,255,0.14)',
  '--border-strong': 'rgba(0,229,255,0.35)',
  '--divider': 'rgba(255,255,255,0.05)',
  '--track': 'rgba(255,255,255,0.07)',
  '--hover-bg': 'rgba(0,229,255,0.06)',
  '--active-bg': 'rgba(0,229,255,0.09)',
  '--seg-active-bg': 'rgba(0,229,255,0.14)',
  '--seg-active-text': '#00e5ff',
  '--text': '#d9f4ff',
  '--text-bright': '#ffffff',
  '--text-strong': '#d9f4ff',
  '--text-dim': '#7d8bb0',
  '--text-mute': '#5a6590',
  '--text-faint': '#49547a',
  '--accent': '#00e5ff',
  '--accent-hover': '#4deeff',
  '--brand-violet': '#9d6bff',
  '--green': '#b6ff3c',
  '--amber': '#ffc24d',
  '--red': '#ff5c7a',
  '--warning-bg': 'rgba(255,194,77,0.08)',
  '--warning-border': 'rgba(255,194,77,0.30)',
  '--warning-text': '#ffc24d',
  '--stale-border': 'rgba(255,46,166,0.35)',
  '--spinner-track': 'rgba(255,255,255,0.14)',
  '--comp-input': '#00e5ff',
  '--comp-output': '#b6ff3c',
  '--comp-cache-creation': '#ffc24d',
  '--comp-cache-read': '#9d6bff',
  '--quota-fill': '#00e5ff',
  '--chart-grid': 'rgba(0,229,255,0.07)',
  '--tooltip-bg': 'rgba(12,14,30,0.95)',
  '--tooltip-border': 'rgba(0,229,255,0.35)',
  '--float-panel': '#0c0e1e'
}

/** Blueprint:mockups/skin-blueprint.html 的蓝图工程图主题 */
const BLUEPRINT_TOKENS: Record<string, string> = {
  '--bg': '#123c69',
  '--panel': 'rgba(14,50,88,0.55)',
  '--panel-sunken': 'rgba(10,40,72,0.55)',
  '--border': 'rgba(232,241,251,0.22)',
  '--border-strong': 'rgba(232,241,251,0.42)',
  '--divider': 'rgba(232,241,251,0.10)',
  '--track': 'rgba(232,241,251,0.12)',
  '--hover-bg': 'rgba(232,241,251,0.06)',
  '--active-bg': 'rgba(232,241,251,0.10)',
  '--seg-active-bg': '#e8f1fb',
  '--seg-active-text': '#123c69',
  '--text': '#e8f1fb',
  '--text-bright': '#ffffff',
  '--text-strong': '#e8f1fb',
  '--text-dim': '#9db8d2',
  '--text-mute': '#6a8bb0',
  '--text-faint': '#54759c',
  '--accent': '#ffd23f',
  '--accent-hover': '#ffdd6b',
  '--brand-violet': '#6ed0ff',
  '--green': '#7be0a3',
  '--amber': '#ff9e5c',
  '--red': '#ff7a5c',
  '--warning-bg': 'rgba(255,210,63,0.10)',
  '--warning-border': 'rgba(255,210,63,0.35)',
  '--warning-text': '#ffd23f',
  '--stale-border': 'rgba(255,158,92,0.45)',
  '--spinner-track': 'rgba(232,241,251,0.18)',
  '--comp-input': '#6ed0ff',
  '--comp-output': '#7be0a3',
  '--comp-cache-creation': '#ffd23f',
  '--comp-cache-read': '#e8f1fb',
  '--quota-fill': '#6ed0ff',
  '--chart-grid': 'rgba(232,241,251,0.10)',
  '--tooltip-bg': '#0e3258',
  '--tooltip-border': 'rgba(232,241,251,0.35)',
  '--float-panel': '#0e3258'
}

export const SKINS: SkinDescriptor[] = [
  {
    id: 'focus',
    name: 'Focus',
    description: 'Quiet, de-boxed layout. Big numbers, hairline separators, neutral quota bars.',
    tokens: FOCUS_TOKENS,
    swatches: ['#0d0f13', '#e7eaf1', '#6e8bff', '#97a1b5', '#b175f8'],
    series: DEFAULT_SERIES
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'The original card-based dark theme with blue accent.',
    tokens: CLASSIC_TOKENS,
    swatches: ['#0f1115', '#171a21', '#5b8ff9', '#5ad8a6', '#9270ca'],
    series: DEFAULT_SERIES
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm cream paper, serif numerals, hairline rules — an editorial light theme.',
    tokens: PAPER_TOKENS,
    swatches: ['#f4f0e6', '#23201a', '#b8542e', '#4a6580', '#9b7bb8'],
    series: goldenSeries(32, 0.52, 0.4)
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Swiss black-on-white typography. Bold rules, zero radius, signal red for limits.',
    tokens: MONO_TOKENS,
    swatches: ['#ffffff', '#0a0a0a', '#8a8a8a', '#e1352b', '#efefef'],
    series: monoSeries(32)
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Cyberpunk glow: cyan/magenta on deep violet-black, luminous charts.',
    tokens: NEON_TOKENS,
    swatches: ['#06060f', '#00e5ff', '#ff2ea6', '#9d6bff', '#b6ff3c'],
    series: goldenSeries(32, 0.92, 0.6)
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'Technical drawing on blueprint blue: grid paper, dashed rules, yellow markups.',
    tokens: BLUEPRINT_TOKENS,
    swatches: ['#123c69', '#e8f1fb', '#ffd23f', '#6ed0ff', '#7be0a3'],
    series: goldenSeries(32, 0.78, 0.64)
  }
]

export const DEFAULT_SKIN_ID = 'focus'

export function getSkin(id: string): SkinDescriptor {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID)!
}

/** 读取持久化的皮肤选择;无记录/非法值回退默认皮肤 */
export function loadStoredSkinId(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    if (id && SKINS.some((s) => s.id === id)) return id
  } catch {
    // localStorage 不可用时静默回退
  }
  return DEFAULT_SKIN_ID
}

/** 应用皮肤:tokens 写到 documentElement 内联 style + data-skin 属性 + 持久化 */
export function applySkin(id: string): void {
  const skin = getSkin(id)
  const root = document.documentElement
  for (const [key, value] of Object.entries(skin.tokens)) {
    root.style.setProperty(key, value)
  }
  root.dataset.skin = skin.id
  try {
    localStorage.setItem(STORAGE_KEY, skin.id)
  } catch {
    // 持久化失败不影响本次生效
  }
}
