<script setup lang="ts">
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import type { sessionsHourlyBuckets } from '../../../shared/analytics'
import { formatAxisTokens, formatTokens } from '../../../shared/format'
import { seriesColor } from '../utils/agent'
import { COMPOSITION_SEGMENTS, OTHER_COLOR } from '../utils/composition'
import { activeSkinId, chartFontFamily, cssToken, neonShadow } from '../utils/skin'

/**
 * Today 的 24h 活动图。数据口径:session 按 lastActivity 本地小时归档,
 * 长会话记在收尾小时 —— 图下注明,不伪装成精确小时计量。
 * 三种视角:Tokens(token 构成,默认)/ By Agent / By Model。
 */
const props = defineProps<{
  buckets: ReturnType<typeof sessionsHourlyBuckets>
}>()

type Mode = 'tokens' | 'agents' | 'models'
const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'agents', label: 'By Agent' },
  { key: 'models', label: 'By Model' }
]
/** token 构成为主视角 */
const mode = ref<Mode>('tokens')

const TOP_MODELS = 5

const isEmpty = computed(() => props.buckets.every((b) => b.totalTokens === 0))

interface SeriesDef {
  name: string
  color: string
  data: number[]
}

const seriesDefs = computed<SeriesDef[]>(() => {
  const buckets = props.buckets
  // touch 皮肤状态:token 模式的段色在 canvas 里需解析 var()
  void activeSkinId.value

  if (mode.value === 'tokens') {
    return COMPOSITION_SEGMENTS.map((s) => ({
      name: s.label,
      color: cssToken(s.token, s.color),
      data: buckets.map((b) => b[`${s.key}Tokens`])
    })).filter((s) => s.data.some((v) => v > 0))
  }

  if (mode.value === 'agents') {
    const totals = new Map<string, number>()
    for (const b of buckets) {
      for (const [k, v] of Object.entries(b.agents)) totals.set(k, (totals.get(k) ?? 0) + v)
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => ({
        name,
        color: seriesColor(name),
        data: buckets.map((b) => b.agents[name] ?? 0)
      }))
  }

  const totals = new Map<string, number>()
  for (const b of buckets) {
    for (const [k, v] of Object.entries(b.models)) totals.set(k, (totals.get(k) ?? 0) + v)
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MODELS)
  const topNames = new Set(top.map(([name]) => name))
  const series = top.map(([name]) => ({
    name,
    color: seriesColor(name),
    data: buckets.map((b) => b.models[name] ?? 0)
  }))
  const other = buckets.map((b) => {
    let sum = 0
    for (const [k, v] of Object.entries(b.models)) if (!topNames.has(k)) sum += v
    return sum
  })
  if (other.some((v) => v > 0)) series.push({ name: 'Other', color: OTHER_COLOR, data: other })
  return series
})

const option = computed(() => {
  // touch 皮肤状态:换肤时重建 option,canvas 不识别 var(),需解析成具体色值
  void activeSkinId.value
  const textDim = cssToken('--text-dim', '#9aa3af')
  const textMute = cssToken('--text-mute', '#6b7280')
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: chartFontFamily() },
    grid: { left: 8, right: 8, top: 28, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: cssToken('--tooltip-bg', '#1e232d'),
      borderColor: cssToken('--tooltip-border', '#2e3542'),
      textStyle: { color: cssToken('--text', '#e6e8eb'), fontSize: 12 },
      valueFormatter: (v: number) => `${formatTokens(v)} (${v.toLocaleString()})`,
      axisPointer: { type: 'shadow' }
    },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: textDim, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10
    },
    xAxis: {
      type: 'category',
      data: props.buckets.map((b) => b.hour),
      axisLine: { lineStyle: { color: cssToken('--border-strong', '#2e3542') } },
      axisTick: { show: false },
      axisLabel: {
        color: textMute,
        fontSize: 10.5,
        interval: 2,
        formatter: (h: number) => `${h}:00`
      }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: cssToken('--chart-grid', '#1e232d') } },
      axisLabel: { color: textMute, fontSize: 11, formatter: (v: number) => formatAxisTokens(v) }
    },
    series: seriesDefs.value.map((s) => ({
      name: s.name,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 14,
      itemStyle: { color: s.color, ...neonShadow(s.color) },
      emphasis: { focus: 'series' },
      data: s.data
    }))
  }
})
</script>

<template>
  <div>
    <div class="mode-toggle">
      <button
        v-for="m in MODES"
        :key="m.key"
        :class="{ active: mode === m.key }"
        @click="mode = m.key"
      >
        {{ m.label }}
      </button>
    </div>
    <p v-if="isEmpty" class="empty">No session activity yet today.</p>
    <VChart v-else :option="option" autoresize class="chart" />
    <p class="note">Sessions attributed to their last-activity hour; long sessions count at completion time.</p>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 200px;
}

/* 与 TrendChart 粒度开关一致的降级小控件 */
.mode-toggle {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.mode-toggle button {
  background: transparent;
  border: none;
  color: var(--text-mute);
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.mode-toggle button:hover {
  color: var(--text);
}

.mode-toggle button.active {
  background: var(--seg-active-bg);
  color: var(--seg-active-text);
  font-weight: 600;
}

.note {
  font-size: 10.5px;
  color: var(--text-faint);
  margin-top: 6px;
}

.empty {
  color: var(--text-mute);
  font-size: 13px;
  padding: 8px 0;
}
</style>
