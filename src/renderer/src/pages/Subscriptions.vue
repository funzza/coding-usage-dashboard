<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { QuotaAccountConfigView, QuotaProviderId } from '../../../main/quota/types'
import QuotaCard from '../components/QuotaCard.vue'
import { useQuotaStore } from '../stores/quota'

/**
 * Subscriptions 页:quota 完整卡片 + 账号管理(从 Settings 迁入)。
 * Overview 的 QuotaStrip 负责速览,这里承载详情与配置。
 */
const quotaStore = useQuotaStore()

/** 有凭据的账号(ok / error 都算;未检测到的不展示卡片) */
const quotaAccounts = computed(() => quotaStore.activeAccounts)

// ---- 订阅账号管理 ----
// provider 展示元数据(supportsManual 决定能否加账号);与 main/quota/service.ts 的注册表对应
const PROVIDER_META: Array<{ id: string; name: string; supportsManual: boolean; tokenHint: string }> = [
  { id: 'kimi', name: 'Kimi', supportsManual: false, tokenHint: '' },
  { id: 'codex', name: 'ChatGPT', supportsManual: true, tokenHint: 'access_token from ~/.codex/auth.json (~10 day TTL)' },
  { id: 'opencode-go', name: 'OpenCode Go', supportsManual: true, tokenHint: 'API key (opencode-go.key in auth.json)' },
  { id: 'grok', name: 'Grok', supportsManual: true, tokenHint: 'key from ~/.grok/auth.json (6h TTL — re-paste when expired)' },
  { id: 'cursor', name: 'Cursor', supportsManual: false, tokenHint: '' }
]

const accounts = ref<QuotaAccountConfigView[]>([])
/** 正在展开添加表单的 provider */
const addFormProvider = ref<string | null>(null)
const addLabel = ref('')
const addToken = ref('')
const addBusy = ref(false)
const addError = ref('')

async function loadAccounts(): Promise<void> {
  accounts.value = await window.usageApi.quotaGetConfig()
}

function accountsOf(providerId: string): QuotaAccountConfigView[] {
  return accounts.value.filter((a) => a.provider === providerId)
}

function accountName(a: QuotaAccountConfigView): string {
  return a.label || PROVIDER_META.find((p) => p.id === a.provider)?.name || a.provider
}

/** 采集状态来自 quota 快照(配置里只有开关) */
function accountStatus(a: QuotaAccountConfigView): { text: string; cls: string; error: string | null } {
  if (!a.enabled) return { text: 'Disabled', cls: 'unavailable', error: null }
  const snap = quotaStore.snapshot?.accounts.find((s) => s.accountId === a.id)
  if (!snap) return { text: 'Pending…', cls: 'unavailable', error: null }
  if (snap.status === 'ok') return { text: 'Connected', cls: 'ok', error: null }
  if (snap.status === 'error') return { text: 'Error', cls: 'error', error: snap.error }
  return { text: 'Not detected', cls: 'unavailable', error: null }
}

async function toggleAccount(a: QuotaAccountConfigView): Promise<void> {
  await window.usageApi.quotaSetEnabled(a.id, a.enabled)
}

function openAddForm(providerId: string): void {
  addFormProvider.value = providerId
  addLabel.value = ''
  addToken.value = ''
  addError.value = ''
}

async function submitAddAccount(): Promise<void> {
  if (!addFormProvider.value || addBusy.value) return
  addBusy.value = true
  addError.value = ''
  try {
    await window.usageApi.quotaAddAccount(
      addFormProvider.value as QuotaProviderId,
      addLabel.value,
      addToken.value
    )
    addFormProvider.value = null
    await loadAccounts()
  } catch (err) {
    // ipc 抛出的 Error 消息带 "Error invoking remote method" 前缀,剥掉
    addError.value = err instanceof Error ? err.message.replace(/^.*Error:\s*/, '') : 'Failed to add account'
  } finally {
    addBusy.value = false
  }
}

async function removeAccount(a: QuotaAccountConfigView): Promise<void> {
  await window.usageApi.quotaRemoveAccount(a.id)
  await loadAccounts()
}

onMounted(loadAccounts)
</script>

<template>
  <div class="page">
    <header class="head drag-head">
      <h1>Subscriptions</h1>
      <button class="btn" :disabled="quotaStore.refreshing" @click="quotaStore.refresh()">
        {{ quotaStore.refreshing ? 'Refreshing…' : 'Refresh quota' }}
      </button>
    </header>

    <!-- 完整 quota 卡片(原 Overview 区块) -->
    <section v-if="quotaAccounts.length > 0" class="panel">
      <div class="quota-grid">
        <QuotaCard v-for="q in quotaAccounts" :key="q.accountId" :quota="q" />
      </div>
    </section>
    <p v-else class="hint">No subscription accounts detected yet. Add or enable one below.</p>

    <!-- 账号管理(从 Settings 迁入) -->
    <section class="panel">
      <h2>Accounts</h2>

      <div class="provider-block" v-for="p in PROVIDER_META" :key="p.id">
        <div class="provider-head">
          <span class="provider-name">{{ p.name }}</span>
          <button
            v-if="p.supportsManual"
            class="link-btn"
            @click="openAddForm(p.id)"
            v-show="addFormProvider !== p.id"
          >
            + Add account
          </button>
        </div>

        <div class="account-row" v-for="a in accountsOf(p.id)" :key="a.id">
          <label class="account-toggle">
            <input type="checkbox" v-model="a.enabled" @change="toggleAccount(a)" />
            <span class="account-name">{{ accountName(a) }}</span>
          </label>
          <span class="source-tag">{{ a.source === 'local' ? 'Local' : 'Manual' }}</span>
          <span class="quota-status" :class="accountStatus(a).cls">{{ accountStatus(a).text }}</span>
          <span
            v-if="accountStatus(a).error"
            class="quota-error"
            :title="accountStatus(a).error ?? ''"
            >{{ accountStatus(a).error }}</span
          >
          <button
            v-if="a.source === 'manual'"
            class="link-btn danger"
            @click="removeAccount(a)"
          >
            Remove
          </button>
        </div>

        <!-- 添加 manual 账号的内联表单 -->
        <div v-if="addFormProvider === p.id" class="add-form">
          <input v-model="addLabel" class="text-input" placeholder="Account label (e.g. Work)" />
          <input
            v-model="addToken"
            class="text-input mono"
            type="password"
            :placeholder="p.tokenHint"
            spellcheck="false"
          />
          <div class="add-actions">
            <button class="btn primary" :disabled="addBusy || !addToken" @click="submitAddAccount">
              {{ addBusy ? 'Verifying…' : 'Add' }}
            </button>
            <button class="btn" :disabled="addBusy" @click="addFormProvider = null">Cancel</button>
          </div>
          <p v-if="addError" class="add-error">{{ addError }}</p>
          <p class="note">The token is verified first, then stored encrypted (Windows DPAPI).</p>
        </div>
      </div>

      <p class="note">
        Quota is read from each provider's own local credentials or official endpoint. Tokens
        never leave this machine and are never shown in the UI.
      </p>
    </section>
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
}

h1 {
  font-size: 18px;
  font-weight: 650;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
}

h2 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.hint {
  font-size: 13px;
  color: var(--text-mute);
}

.btn {
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  background: var(--border-strong);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
  font-weight: 600;
}

.btn.primary:hover {
  background: var(--accent-hover);
}

.note {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
}

.quota-status {
  font-size: 12px;
  font-weight: 600;
}

.quota-status.ok {
  color: var(--green);
}

.quota-status.error {
  color: var(--amber);
}

.quota-status.unavailable {
  color: var(--text-mute);
}

.quota-error {
  margin-left: 8px;
  font-size: 11px;
  color: var(--amber);
}

.provider-block {
  margin-bottom: 14px;
}

.provider-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.provider-name {
  font-size: 13px;
  font-weight: 600;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0 5px 14px;
  font-size: 13px;
}

.account-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  min-width: 160px;
}

.account-name {
  color: var(--text);
}

.source-tag {
  font-size: 10px;
  color: var(--text-mute);
  background: var(--track);
  border-radius: 4px;
  padding: 1px 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}

.link-btn:hover {
  text-decoration: underline;
}

.link-btn.danger {
  color: var(--red);
}

.add-form {
  margin: 8px 0 4px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}

.text-input {
  background: var(--panel-sunken);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--text);
  outline: none;
}

.text-input:focus {
  border-color: var(--accent);
}

.text-input.mono {
  font-family: monospace;
  font-size: 12px;
}

.add-actions {
  display: flex;
  gap: 8px;
}

.add-error {
  font-size: 12px;
  color: var(--red);
}

/* ---------- Focus 皮肤 ---------- */
[data-skin='focus'] .page {
  gap: 34px;
}

[data-skin='focus'] h1 {
  font-size: 15px;
  font-weight: 600;
}

[data-skin='focus'] .panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

[data-skin='focus'] h2 {
  font-size: 10.5px;
  letter-spacing: 0.09em;
  color: var(--text-mute);
}

/* 卡片在 focus 下依然保留(卡片本身有 focus 适配),仅去外层盒子 */
[data-skin='focus'] .quota-grid {
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

@media (max-width: 1240px) {
  [data-skin='focus'] .quota-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
