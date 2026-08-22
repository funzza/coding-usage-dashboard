<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { formatTokens } from '../../../shared/format'
import type { RankItem } from '../utils/composition'
import { activeSkinId, chartFontFamily, cssToken, neonShadow } from '../utils/skin'

/**
 * 占比环图:Today 视图的主视觉。中心总量用 HTML 覆盖层(跟随皮肤 token),
 * 明细由旁边的列表承担,环图只负责"占比直觉"。
 */
const props = defineProps<{
  items: RankItem[]
  centerLabel: string
  centerValue: string
  centerSub?: string
}>()

const option = computed(() => {
  // touch 皮肤状态:换肤时重建 option,canvas 不识别 var(),需解析成具体色值
  void activeSkinId.value
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: chartFontFamily() },
    tooltip: {
      trigger: 'item',
      backgroundColor: cssToken('--tooltip-bg', '#1e232d'),
      borderColor: cssToken('--tooltip-border', '#2e3542'),
      textStyle: { color: cssToken('--text', '#e6e8eb'), fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${formatTokens(p.value)} (${p.value.toLocaleString()}) · ${p.percent.toFixed(1)}%`
    },
    series: [
      {
        type: 'pie',
        radius: ['64%', '82%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: {
          borderColor: cssToken('--bg', '#0d0f13'),
          borderWidth: 2
        },
        emphasis: { scaleSize: 4 },
        data: props.items.map((it) => ({
          name: it.name,
          value: it.usage.totalTokens,
          itemStyle: { color: it.color, ...neonShadow(it.color) }
        }))
      }
    ]
  }
})
</script>

<template>
  <div class="donut">
    <p v-if="items.length === 0" class="empty">No usage in this range.</p>
    <template v-else>
      <VChart :option="option" autoresize class="chart" />
      <div class="center">
        <span class="c-k">{{ centerLabel }}</span>
        <span class="c-v">{{ centerValue }}</span>
        <span v-if="centerSub" class="c-s">{{ centerSub }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.donut {
  position: relative;
  width: 100%;
  max-width: 320px;
  aspect-ratio: 1;
}

.chart {
  width: 100%;
  height: 100%;
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
}

.c-k {
  font-size: 11px;
  color: var(--text-mute);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.c-v {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-bright);
}

.c-s {
  font-size: 12px;
  color: var(--text-mute);
  font-variant-numeric: tabular-nums;
}

.empty {
  color: var(--text-mute);
  font-size: 13px;
  padding: 8px 0;
}
</style>
