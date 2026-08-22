<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionUsage } from '../../../shared/usage-model'
import { formatCost, formatTokens } from '../../../shared/format'
import { useSessionsStore } from '../stores/sessions'
import { agentColor, displayAgentName } from '../utils/agent'

/**
 * Sessions 维度:数据来自 `ccusage session --json --by-agent`(主进程按需调用)。
 * 单次调用可能 1-2 分钟,只在进入页面 / 点 Refresh 时触发,绝不随 App 启动加载。
 * 数据与缓存由 stores/sessions.ts 统一管理(Overview 的 Today 活动图共享同一份)。
 */
const store = useSessionsStore()
const { report, loading, error } = storeToRefs(store)
const filterAgent = ref<string>('all')

const agents = computed(() => {
  const set = new Set<string>()
  for (const s of report.value?.sessions ?? []) {
    set.add(s.agent)
  }
  return [...set].sort()
})

const filtered = computed<SessionUsage[]>(() => {
  const sessions = report.value?.sessions ?? []
  if (filterAgent.value === 'all') return sessions
  return sessions.filter((s) => s.agent === filterAgent.value)
})

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${date} ${time}`
}

function modelNames(s: SessionUsage): string {
  return s.models.map((m) => m.model).join(', ')
}

onMounted(() => {
  void store.ensure()
})
</script>

<template>
  <div class="page">
    <header class="head drag-head">
      <h1>Sessions</h1>
      <div class="actions">
        <select v-if="agents.length > 1" v-model="filterAgent" class="filter">
          <option value="all">All agents</option>
          <option v-for="a in agents" :key="a" :value="a">{{ displayAgentName(a) }}</option>
        </select>
        <button class="refresh-btn" :disabled="loading" @click="store.ensure(true)">
          <span class="spinner" v-if="loading" />
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="loading && !report" class="hint">
      Running ccusage session… this may take 1–2 minutes.
    </p>

    <div v-if="error" class="warning-banner">
      Failed to load sessions: {{ error }}
      <template v-if="report">— showing previous data.</template>
      <button class="link" @click="store.ensure(true)">Retry</button>
    </div>

    <section v-if="filtered.length > 0" class="panel">
      <table class="table">
        <thead>
          <tr>
            <th>Last Activity</th>
            <th>Agent</th>
            <th>Models</th>
            <th class="num">Input</th>
            <th class="num">Output</th>
            <th class="num">Cache Read</th>
            <th class="num">Cache Creation</th>
            <th class="num">Total</th>
            <th class="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td class="time">{{ formatTime(s.lastActivity) }}</td>
            <td>
              <span class="agent">
                <span class="dot" :style="{ background: agentColor(s.agent) }" />
                {{ displayAgentName(s.agent) }}
              </span>
            </td>
            <td class="models" :title="modelNames(s)">{{ modelNames(s) }}</td>
            <td class="num" :title="s.inputTokens.toLocaleString()">{{ formatTokens(s.inputTokens) }}</td>
            <td class="num" :title="s.outputTokens.toLocaleString()">{{ formatTokens(s.outputTokens) }}</td>
            <td class="num" :title="s.cacheReadTokens.toLocaleString()">{{ formatTokens(s.cacheReadTokens) }}</td>
            <td class="num" :title="s.cacheCreationTokens.toLocaleString()">{{ formatTokens(s.cacheCreationTokens) }}</td>
            <td class="num total" :title="s.totalTokens.toLocaleString()">{{ formatTokens(s.totalTokens) }}</td>
            <td class="num cost">{{ formatCost(s.totalCost) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-else-if="!loading && !error" class="empty">
      <p>No sessions found. Use a coding agent, then refresh.</p>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

h1 {
  font-size: 18px;
  font-weight: 650;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter {
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--border-strong);
}

.refresh-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--spinner-track);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hint {
  font-size: 12px;
  color: var(--text-mute);
}

.warning-banner {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  color: var(--warning-text);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-mute);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--divider);
  color: #c8ced8;
  white-space: nowrap;
}

.table tbody tr:last-child td {
  border-bottom: none;
}

.table tbody tr:hover td {
  background: var(--active-bg);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.time {
  color: var(--text-dim);
}

.agent {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.models {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
}

.total {
  color: var(--text);
  font-weight: 600;
}

.cost {
  color: var(--text-mute);
}

.empty {
  color: var(--text-dim);
  padding: 40px 0;
  text-align: center;
}
</style>
