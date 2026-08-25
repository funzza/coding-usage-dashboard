<script setup lang="ts">
import { useUsageStore } from '../stores/usage'
import type { OriginFilter } from '../../../shared/analytics'

const store = useUsageStore()

const options: Array<{ key: OriginFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'windows', label: 'Win' },
  { key: 'wsl', label: 'WSL' }
]
</script>

<template>
  <div class="tabs" role="tablist" title="Filter by data origin (Windows / WSL)">
    <button
      v-for="o in options"
      :key="o.key"
      class="tab"
      :class="{ active: store.origin === o.key }"
      @click="store.origin = o.key"
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
