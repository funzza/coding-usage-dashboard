<script setup lang="ts">
import { useUsageStore } from '../stores/usage'

/**
 * 全局维度开关(Models/Agents):滑动 thumb 分段控件。
 * 唯一数据源是 store.dimension —— 侧栏 Today 速览与 Overview 全部图表联动;
 * 默认 Models(token 消耗主要从模型视角看)。
 */
const store = useUsageStore()

const options = [
  { key: 'models', label: 'Models' },
  { key: 'agents', label: 'Agents' }
] as const
</script>

<template>
  <div class="dswitch" role="tablist" aria-label="Analysis dimension">
    <span class="thumb" :class="{ right: store.dimension === 'agents' }" aria-hidden="true" />
    <button
      v-for="o in options"
      :key="o.key"
      class="opt"
      :class="{ active: store.dimension === o.key }"
      role="tab"
      :aria-selected="store.dimension === o.key"
      @click="store.dimension = o.key"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.dswitch {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
}

.thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 6px;
  background: var(--seg-active-bg);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.thumb.right {
  transform: translateX(100%);
}

.opt {
  position: relative;
  z-index: 1;
  background: transparent;
  border: none;
  color: var(--text-mute);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.18s;
}

.opt:hover {
  color: var(--text);
}

.opt.active {
  color: var(--seg-active-text);
  font-weight: 600;
}

/* ---------- Focus 皮肤:更小更灰 ---------- */
[data-skin='focus'] .opt {
  font-size: 10.5px;
  letter-spacing: 0.09em;
}
</style>
