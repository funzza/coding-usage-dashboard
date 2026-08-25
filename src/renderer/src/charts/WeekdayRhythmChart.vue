<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { DailyUsage } from '../../../shared/usage-model'
import { weekdayAverages } from '../../../shared/analytics'
import { formatAxisTokens, formatTokens } from '../../../shared/format'
import { activeSkinId, chartFontFamily, cssToken, neonShadow } from '../utils/skin'

/**
 * 星期节律:区间内周一~周日的日均用量。最高的一天用 accent 高亮。
 * 7D 窗口下每个星期只出现一次(退化为单日值),属预期行为。
 */
const props = defineProps<{
  /** 已补零的连续区间数据 */
  days: DailyUsage[]
}>()

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const avgs = computed(() => weekdayAverages(props.days))
const maxAvg = computed(() => Math.max(0, ...avgs.value.map((w) => w.avg)))
const isEmpty = computed(() => maxAvg.value <= 0)

const option = computed(() => {
  // touch 皮肤状态:换肤时重建 option,canvas 不识别 var(),需解析成具体色值
  void activeSkinId.value
  const textMute = cssToken('--text-mute', '#6b7280')
  const accent = cssToken('--accent', '#6e8bff')
  const idle = cssToken('--border-strong', '#2e3542')
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: chartFontFamily() },
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: cssToken('--tooltip-bg', '#1e232d'),
      borderColor: cssToken('--tooltip-border', '#2e3542'),
      textStyle: { color: cssToken('--text', '#e6e8eb'), fontSize: 12 },
      formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0]?.dataIndex ?? 0
        const avg = avgs.value[i]?.avg ?? 0
        return `${LABELS[i]} · avg ${formatTokens(avg)} (${Math.round(avg).toLocaleString()})`
      }
    },
    xAxis: {
      type: 'category',
      data: LABELS,
      axisLine: { lineStyle: { color: idle } },
      axisTick: { show: false },
      axisLabel: { color: textMute, fontSize: 10.5 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: cssToken('--chart-grid', '#1e232d') } },
      axisLabel: { color: textMute, fontSize: 10.5, formatter: (v: number) => formatAxisTokens(v) }
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        data: avgs.value.map((w) => {
          const color = w.avg === maxAvg.value && w.avg > 0 ? accent : idle
          return {
            value: Math.round(w.avg),
            itemStyle: { color, borderRadius: [3, 3, 0, 0], ...neonShadow(color) }
          }
        })
      }
    ]
  }
})
</script>

<template>
  <p v-if="isEmpty" class="empty">No usage in this range.</p>
  <VChart v-else :option="option" autoresize class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 170px;
}

.empty {
  color: var(--text-mute);
  font-size: 13px;
  padding: 8px 0;
}
</style>
