<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DailyUsage } from '../../../shared/usage-model'
import { bucketDaily, type BucketGranularity, type RangeKey } from '../../../shared/analytics'
import DailyBarChart from './DailyBarChart.vue'

/**
 * 趋势图:DailyBarChart + Day/Week/Month 粒度切换。
 * 粒度默认值跟随全局 range('all' → Week,其余 → Day);range 变化时重置,
 * 用户可手动覆盖。开关视觉降级为小控件,不与 RangeTabs 抢"时间上下文"的角色。
 */
const props = withDefaults(
  defineProps<{
    /** 已补零的连续日数据(selectRangeDaily) */
    days: DailyUsage[]
    mode: 'agents' | 'models' | 'agent' | 'model'
    name?: string
    /** 全局时间范围;决定粒度默认值 */
    range?: RangeKey
  }>(),
  { name: undefined, range: undefined }
)

const GRANULARITIES: Array<{ key: BucketGranularity; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' }
]

const defaultGranularity = (): BucketGranularity => (props.range === 'all' ? 'week' : 'day')

const granularity = ref<BucketGranularity>(defaultGranularity())

watch(
  () => props.range,
  () => {
    granularity.value = defaultGranularity()
  }
)

const bucketedDays = computed(() => bucketDaily(props.days, granularity.value))
</script>

<template>
  <div class="trend">
    <div class="gran-toggle">
      <button
        v-for="g in GRANULARITIES"
        :key="g.key"
        :class="{ active: granularity === g.key }"
        @click="granularity = g.key"
      >
        {{ g.label }}
      </button>
    </div>
    <DailyBarChart :days="bucketedDays" :mode="mode" :name="name" :granularity="granularity" />
  </div>
</template>

<style scoped>
.trend {
  display: flex;
  flex-direction: column;
}

/* 降级为小控件:无底板,字号更小 */
.gran-toggle {
  display: inline-flex;
  align-self: flex-end;
  gap: 2px;
}

.gran-toggle button {
  background: transparent;
  border: none;
  color: var(--text-mute);
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.gran-toggle button:hover {
  color: var(--text);
}

.gran-toggle button.active {
  background: var(--seg-active-bg);
  color: var(--seg-active-text);
  font-weight: 600;
}
</style>
