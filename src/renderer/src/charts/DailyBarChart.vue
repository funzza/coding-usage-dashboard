<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { DailyUsage } from '../../../shared/usage-model'
import { bucketLabel, modelTotalsByDay, type BucketGranularity } from '../../../shared/analytics'
import { formatAxisTokens, formatTokens } from '../../../shared/format'
import { seriesColor } from '../utils/agent'
import { activeSkinId, chartFontFamily, cssToken, neonShadow } from '../utils/skin'

const OTHER_COLOR = '#3a4356'
const MODEL_STACK_TOP = 5

const props = withDefaults(
  defineProps<{
    /** 调用方传入已补零的连续日期(selectRangeDaily),或 bucketDaily 产出的周/月 bucket */
    days: DailyUsage[]
    /** agents/models = 堆叠;agent/model = 单一系列(需配合 name) */
    mode: 'agents' | 'models' | 'agent' | 'model'
    name?: string
    /** days 的粒度,只影响 X 轴标签格式 */
    granularity?: BucketGranularity
  }>(),
  { name: undefined, granularity: 'day' }
)

interface SeriesDef {
  name: string
  color: string
  data: number[]
}

const seriesDefs = computed<SeriesDef[]>(() => {
  const days = props.days

  if (props.mode === 'agents') {
    const names = [...new Set(days.flatMap((d) => d.agents.map((a) => a.agent)))]
    return names.map((name) => ({
      name,
      color: seriesColor(name),
      data: days.map((d) => d.agents.find((a) => a.agent === name)?.totalTokens ?? 0)
    }))
  }

  const byDay = modelTotalsByDay(days)

  if (props.mode === 'models') {
    const totals = new Map<string, number>()
    for (const d of byDay) {
      for (const [model, v] of d.byModel) totals.set(model, (totals.get(model) ?? 0) + v)
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MODEL_STACK_TOP)
    const topNames = new Set(top.map(([name]) => name))
    const series = top.map(([name]) => ({
      name,
      color: seriesColor(name),
      data: byDay.map((d) => d.byModel.get(name) ?? 0)
    }))
    const other = byDay.map((d) => {
      let sum = 0
      for (const [model, v] of d.byModel) if (!topNames.has(model)) sum += v
      return sum
    })
    if (other.some((v) => v > 0)) series.push({ name: 'Other', color: OTHER_COLOR, data: other })
    return series
  }

  if (props.mode === 'agent' && props.name) {
    return [
      {
        name: props.name,
        color: seriesColor(props.name),
        data: days.map((d) => d.agents.find((a) => a.agent === props.name)?.totalTokens ?? 0)
      }
    ]
  }

  // mode === 'model'
  return [
    {
      name: props.name ?? '',
      color: seriesColor(props.name ?? ''),
      data: byDay.map((d) => d.byModel.get(props.name ?? '') ?? 0)
    }
  ]
})

const isStacked = computed(() => props.mode === 'agents' || props.mode === 'models')

/** 柱间距随桶数自适应:短图表粗柱、长图表细柱,整体保持紧凑不稀疏 */
const barCategoryGap = computed(() => {
  const n = props.days.length
  return n <= 8 ? '45%' : n <= 16 ? '55%' : '62%'
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
    valueFormatter: (v: number) => `${formatTokens(v)} (${v.toLocaleString()})`
  },
  legend: isStacked.value
    ? { top: 0, right: 0, textStyle: { color: textDim, fontSize: 11 }, itemWidth: 10, itemHeight: 10 }
    : undefined,
  xAxis: {
    type: 'category',
    data: props.days.map((d) => bucketLabel(d.date, props.granularity)),
    axisLine: { lineStyle: { color: cssToken('--border-strong', '#2e3542') } },
    axisTick: { show: false },
    axisLabel: { color: textMute, fontSize: 11 }
  },
  yAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: cssToken('--chart-grid', '#1e232d') } },
    axisLabel: { color: textMute, fontSize: 11, formatter: (v: number) => formatAxisTokens(v) }
  },
  series: seriesDefs.value.map((s) => ({
    name: s.name,
    type: 'bar',
    stack: isStacked.value ? 'total' : undefined,
    barCategoryGap: barCategoryGap.value,
    itemStyle: { color: s.color, borderRadius: isStacked.value ? 0 : [3, 3, 0, 0], ...neonShadow(s.color) },
    emphasis: { focus: 'series' },
    data: s.data
  }))
  }
})
</script>

<template>
  <VChart :option="option" autoresize class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 260px;
}
</style>
