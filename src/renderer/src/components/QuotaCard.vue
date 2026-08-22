<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { QuotaAccount } from '../../../main/quota/types'
import { formatResetIn } from '../../../shared/format'
import { agentColor } from '../utils/agent'
import { quotaBarColor } from '../utils/quota'
import CycleUsage from './CycleUsage.vue'

/** 单个订阅账号的 quota 卡片:窗口进度条 + 本周期 tokens(并排参考,不同口径不换算)+ 重置倒计时;error 态保留旧数据并标注 */
const props = defineProps<{ quota: QuotaAccount }>()

// 倒计时随时间走,30s 重算
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
})

const color = computed(() => agentColor(props.quota.agent))

function barColor(percent: number): string {
  return quotaBarColor(percent, color.value)
}

function resetText(resetsAt: string | null): string {
  return formatResetIn(resetsAt, now.value) ?? ''
}

/** 用量打满(>=100%)的窗口:卡片底部加一行耗尽注脚 */
const exhaustedWindows = computed(() => props.quota.windows.filter((w) => w.usedPercent >= 100))

const updatedText = computed(() => {
  if (!props.quota.updatedAt) return ''
  const mins = Math.max(0, Math.round((now.value - new Date(props.quota.updatedAt).getTime()) / 60_000))
  return mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`
})
</script>

<template>
  <article class="quota-card" :class="{ stale: quota.status === 'error' }">
    <header class="card-head">
      <span class="dot" :style="{ background: color }" />
      <span class="name">{{ quota.label }}</span>
      <span v-if="quota.label !== quota.displayName" class="provider-tag">{{
        quota.displayName
      }}</span>
      <span v-if="quota.plan" class="plan">{{ quota.plan }}</span>
      <span class="spacer" />
      <span v-if="quota.status === 'error'" class="warn" :title="quota.error ?? ''">stale</span>
      <span v-else-if="updatedText" class="updated">{{ updatedText }}</span>
    </header>

    <ul class="windows">
      <li v-for="w in quota.windows" :key="w.key">
        <span class="w-label">{{ w.label }}</span>
        <span class="w-bar">
          <span
            class="w-fill"
            :style="{ width: `${w.usedPercent}%`, background: barColor(w.usedPercent) }"
          />
        </span>
        <span class="w-pct" :class="{ alert: w.usedPercent >= 100 }">{{ Math.round(w.usedPercent) }}%</span>
        <CycleUsage :window="w" />
        <span class="w-reset">{{ resetText(w.resetsAt) }}</span>
      </li>
    </ul>

    <p v-if="quota.windows.length === 0" class="no-data">No quota data yet.</p>

    <p v-for="w in exhaustedWindows" :key="`exhausted-${w.key}`" class="exhausted">
      {{ w.label }} quota exhausted
    </p>

    <footer v-if="quota.extras.length > 0" class="extras">
      <span v-for="e in quota.extras" :key="e.label" class="extra">
        {{ e.label }} <b>{{ e.value }}</b>
      </span>
    </footer>
  </article>
</template>

<style scoped>
.quota-card {
  background: var(--panel-sunken);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.quota-card.stale {
  border-color: var(--stale-border);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
}

.plan {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--track);
  border-radius: 5px;
  padding: 1px 7px;
}

.provider-tag {
  font-size: 11px;
  color: var(--text-mute);
}

.spacer {
  flex: 1;
}

.updated {
  font-size: 11px;
  color: var(--text-mute);
}

.warn {
  font-size: 11px;
  color: var(--amber);
}

.windows {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.windows li {
  display: grid;
  grid-template-columns: 52px 1fr 36px auto 72px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.w-label {
  color: var(--text-dim);
}

.w-bar {
  height: 5px;
  background: var(--track);
  border-radius: 3px;
  overflow: hidden;
}

.w-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.w-pct {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.w-reset {
  font-size: 11px;
  color: var(--text-mute);
  text-align: right;
}

.no-data {
  font-size: 12px;
  color: var(--text-mute);
}

.exhausted {
  font-size: 11.5px;
  color: var(--red);
}

.extras {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--text-mute);
}

.extra b {
  color: var(--text-dim);
  font-weight: 600;
}

/* ---------- Focus 皮肤:更扁的卡,quota 行重排成"上信息行 + 下细条" ---------- */
[data-skin='focus'] .quota-card {
  background: transparent;
  border-color: var(--border);
  padding: 14px 16px;
  gap: 12px;
}

[data-skin='focus'] .windows {
  gap: 11px;
}

[data-skin='focus'] .windows li {
  grid-template-columns: auto 1fr auto auto;
  grid-template-areas:
    'label reset cycle pct'
    'bar bar bar bar';
  row-gap: 6px;
  column-gap: 8px;
}

[data-skin='focus'] .w-label {
  grid-area: label;
  font-size: 11.5px;
}

[data-skin='focus'] .w-reset {
  grid-area: reset;
  text-align: left;
}

[data-skin='focus'] .windows li :deep(.cycle) {
  grid-area: cycle;
  flex-direction: row;
  gap: 4px;
  align-items: baseline;
}

[data-skin='focus'] .w-pct {
  grid-area: pct;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-strong);
}

[data-skin='focus'] .w-pct.alert {
  color: var(--red);
}

[data-skin='focus'] .w-bar {
  grid-area: bar;
  height: 3px;
  border-radius: 2px;
}
</style>
