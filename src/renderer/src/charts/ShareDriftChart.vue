<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { DailyUsage } from '../../../shared/usage-model'
import { shareDrift } from '../../../shared/analytics'
import { shortDate } from '../../../shared/format'
import { agentColor, seriesColor } from '../utils/agent'
import { OTHER_COLOR } from '../utils/composition'
import { activeSkinId, chartFontFamily, cssToken, neonShadow } from '../utils/skin'

/**
 * 占比漂移图:区间内每日各 agent/model 的份额变化(100% 堆叠面积)。
 * 回答"结构在变吗"——例如从 Claude 转向 Kimi。
 */
const props = defineProps<{
  /** 已补零的连续区间数据(All 区间调用方应先按周 bucket) */
  days: DailyUsage[]
  mode: 'agents' | 'models'
}>()

const drift = computed(() => shareDrift(props.days, props.mode))

const isEmpty = computed(() => drift.value.names.length === 0)

const option = computed(() => {
  // touch 皮肤状态:换肤时重建 option,canvas 不识别 var(),需解析成具体色值
  void activeSkinId.value
  const textDim = cssToken('--text-dim', '#9aa3af')
  const textMute = cssToken('--text-mute', '#6b7280')
  const { dates, names, shares } = drift.value
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: chartFontFamily() },
    grid: { left: 8, right: 8, top: 28, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: cssToken('--tooltip-bg', '#1e232d'),
      borderColor: cssToken('--tooltip-border', '#2e3542'),
      textStyle: { color: cssToken('--text', '#e6e8eb'), fontSize: 12 },
      valueFormatter: (v: number) => `${v.toFixed(1)}%`
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
      boundaryGap: false,
      data: dates.map(shortDate),
      axisLine: { lineStyle: { color: cssToken('--border-strong', '#2e3542') } },
      axisTick: { show: false },
      axisLabel: { color: textMute, fontSize: 10.5 }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: cssToken('--chart-grid', '#1e232d') } },
      axisLabel: { color: textMute, fontSize: 10.5, formatter: '{value}%' }
    },
    series: names.map((name, i) => {
      const color = name === 'Other' ? OTHER_COLOR : props.mode === 'agents' ? agentColor(name) : seriesColor(name)
      return {
        name,
        type: 'line',
        stack: 'share',
        symbol: 'none',
        smooth: false,
        lineStyle: { width: 0 },
        areaStyle: { opacity: 0.72 },
        itemStyle: { color, ...neonShadow(color) },
        emphasis: { focus: 'series' },
        data: shares[i]
      }
    })
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
  height: 210px;
}

.empty {
  color: var(--text-mute);
  font-size: 13px;
  padding: 8px 0;
}
</style>
