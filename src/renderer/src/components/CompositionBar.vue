<script setup lang="ts">
import { computed } from 'vue'
import type { TokenUsage } from '../../../shared/usage-model'
import { COMPOSITION_SEGMENTS, compositionTooltip } from '../utils/composition'

/**
 * Token 构成条。默认 100% 宽(只看构成);
 * 传入 maxTokens 后外层出现满宽轨道,条长 ∝ totalTokens/maxTokens —— 列表行量级可比较。
 */
const props = defineProps<{ usage: TokenUsage; maxTokens?: number }>()

const segments = computed(() => {
  const u = props.usage
  const parts = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens
  if (parts <= 0) return []
  return COMPOSITION_SEGMENTS.map((s) => ({
    ...s,
    value: u[`${s.key}Tokens`],
    pct: (u[`${s.key}Tokens`] / parts) * 100
  })).filter((s) => s.pct > 0)
})

/** hover 显示每段真实数字,不再只是段名 */
const tooltip = computed(() => compositionTooltip(props.usage))

/** 等比条宽;>0 时保底 2% 保证可见 */
const widthPct = computed(() => {
  const max = props.maxTokens
  if (!max || max <= 0) return null
  const t = props.usage.totalTokens
  if (t <= 0) return 0
  return Math.max(2, (t / max) * 100)
})
</script>

<template>
  <span v-if="widthPct === null" class="composition" :title="tooltip">
    <span
      v-for="s in segments"
      :key="s.key"
      class="seg"
      :style="{ width: `${s.pct}%`, background: `var(${s.token})` }"
    />
  </span>
  <span v-else class="track" :title="tooltip">
    <span class="composition scaled" :style="{ width: `${widthPct}%` }">
      <span
        v-for="s in segments"
        :key="s.key"
        class="seg"
        :style="{ width: `${s.pct}%`, background: `var(${s.token})` }"
      />
    </span>
  </span>
</template>

<style scoped>
.composition {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--divider);
}

.composition.scaled {
  background: transparent;
  height: 100%;
}

.track {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: var(--divider);
}

.seg {
  display: block;
  height: 100%;
}
</style>
