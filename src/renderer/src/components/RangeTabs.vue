<script setup lang="ts">
import { useUsageStore } from '../stores/usage'
import type { RangeKey } from '../../../shared/analytics'

const store = useUsageStore()

const options: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Weekly' },
  { key: '30d', label: 'Monthly' },
  { key: 'all', label: 'All' }
]
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="o in options"
      :key="o.key"
      class="tab"
      :class="{ active: store.range === o.key }"
      @click="store.range = o.key"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
}

.tab {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  background: var(--seg-active-bg);
  color: var(--seg-active-text);
  font-weight: 600;
}
</style>
