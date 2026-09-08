<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  addOfflineAccount,
  copyText,
  errText,
  getSelectedAccount,
  listYggdrasilProviders,
  loginYggdrasil,
  msBeginLogin,
  msCancelLogin,
  onMsLoginDone,
  probeYggdrasilProvider,
  prepareYggdrasilRuntime,
  refreshAccount,
  removeAccount,
  removeYggdrasilProvider,
  saveYggdrasilProvider,
  selectYggdrasilProfile,
  selectAccount
} from '../api'
import { refreshAccounts, store, toast } from '../store'
import Avatar from '../components/Avatar.vue'
import type {
  Account,
  MsDeviceCodeInfo,
  YggdrasilLoginResult,
  YggdrasilProvider,
  YggdrasilProviderCandidate,
  YggdrasilProviderInput
} from '@shared/types'

const accountMode = ref<'microsoft' | 'offline' | 'yggdrasil'>('microsoft')

// ---------------- 添加离线账号 ----------------
const newName = ref('')
const adding = ref(false)

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/
const nameError = computed(() => {
  if (!newName.value) return ''
  if (!NAME_RE.test(newName.value)) return '用户名需为 3-16 位字母、数字或下划线'
  return ''
})

async function onAddOffline() {
  const name = newName.value.trim()
  if (!NAME_RE.test(name)) {
    toast('用户名需为 3-16 位字母、数字或下划线', 'error')
    return
  }
  adding.value = true
  try {
    await addOfflineAccount(name)
    await refreshAccounts()
    newName.value = ''
    toast(`已添加离线账号 ${name}`, 'success')
  } catch (e) {
    toast('添加失败：' + errText(e), 'error')
  } finally {
    adding.value = false
  }
}

// ---------------- 微软登录 ----------------
const ms = reactive({
  open: false,
  waiting: false,
  starting: false,
  autoCopied: false,
  info: null as MsDeviceCodeInfo | null
})

async function beginMsLogin() {
  if (ms.starting) return
  ms.starting = true
  try {
    ms.info = await msBeginLogin()
    ms.open = true
    ms.waiting = true
    // 设备代码出现的瞬间自动写入剪贴板，玩家到验证页直接粘贴即可
    ms.autoCopied = false
    if (ms.info.userCode) {
      ms.autoCopied = await copyText(ms.info.userCode)
    }
  } catch (e) {
    toast('无法开始微软登录：' + errText(e), 'error')
  } finally {
    ms.starting = false
  }
}

async function cancelMsLogin() {
  ms.open = false
  ms.waiting = false
  try {
    await msCancelLogin()
  } catch {
    /* 忽略取消时的异常 */
  }
}

async function copyCode() {
  if (!ms.info) return
  const ok = await copyText(ms.info.userCode)
  toast(ok ? '已复制验证码' : '复制失败，请手动复制', ok ? 'success' : 'error')
}

function openVerifyPage() {
  if (ms.info) window.open(ms.info.verificationUri)
}

let offMsDone: (() => void) | null = null

// ---------------- 外置 Yggdrasil ----------------
const providers = ref<YggdrasilProvider[]>([])
const providerModal = reactive({
  open: false,
  source: '' as string,
  input: null as YggdrasilProviderInput | null,
  probing: false,
  saving: false,
  error: '',
  requireInsecure: false,
  allowInsecure: false,
  candidate: null as YggdrasilProviderCandidate | null
})
const yggLogin = reactive({
  providerId: '',
  identifier: '',
  password: '',
  busy: false
})
const profileModal = reactive({
  open: false,
  challengeId: '',
  providerName: '',
  profiles: [] as Array<{ id: string; name: string }>,
  selectedId: '',
  busy: false
})
const refreshingId = ref<string | null>(null)
const removingProviderId = ref<string | null>(null)
const checkingRuntime = ref(false)

async function loadProviders() {
  try {
    providers.value = await listYggdrasilProviders()
    if (!yggLogin.providerId || !providers.value.some((p) => p.id === yggLogin.providerId)) {
      yggLogin.providerId = providers.value[0]?.id ?? ''
    }
  } catch (e) {
    toast('读取外置登录提供商失败：' + errText(e), 'error')
  }
}

function openProviderImport(input?: YggdrasilProviderInput) {
  Object.assign(providerModal, {
    open: true,
    source: input?.value ?? '',
    input: input ?? null,
    probing: false,
    saving: false,
    error: '',
    requireInsecure: false,
    allowInsecure: false,
    candidate: null
  })
  if (input) void probeProviderInput()
}

async function probeProviderInput() {
  if (providerModal.probing) return
  const input = providerModal.input ?? { kind: 'text' as const, value: providerModal.source }
  if (input.kind === 'text') input.value = providerModal.source
  providerModal.input = input
  providerModal.probing = true
  providerModal.error = ''
  providerModal.candidate = null
  try {
    providerModal.candidate = await probeYggdrasilProvider(input, providerModal.allowInsecure)
    providerModal.requireInsecure = providerModal.candidate.insecure
  } catch (e) {
    const message = errText(e).replace(/^Error invoking remote method '[^']+':\s*/, '')
    providerModal.requireInsecure = message.includes('INSECURE_YGGDRASIL')
    providerModal.error = message.replace('INSECURE_YGGDRASIL:', '')
  } finally {
    providerModal.probing = false
  }
}

async function confirmProvider() {
  const candidate = providerModal.candidate
  if (!candidate || providerModal.saving) return
  if (candidate.insecure && !providerModal.allowInsecure) {
    providerModal.error = '必须主动确认明文 HTTP 风险后才能保存'
    return
  }
  providerModal.saving = true
  try {
    providers.value = await saveYggdrasilProvider(candidate, providerModal.allowInsecure)
    yggLogin.providerId = candidate.id
    providerModal.open = false
    toast(`已保存外置登录提供商 ${candidate.name}`, 'success')
  } catch (e) {
    providerModal.error = errText(e)
  } finally {
    providerModal.saving = false
  }
}

async function onRemoveProvider(provider: YggdrasilProvider) {
  if (removingProviderId.value) return
  removingProviderId.value = provider.id
  try {
    providers.value = await removeYggdrasilProvider(provider.id)
    if (yggLogin.providerId === provider.id) yggLogin.providerId = providers.value[0]?.id ?? ''
    toast(`已删除提供商 ${provider.name}`, 'success')
  } catch (e) {
    toast('删除提供商失败：' + errText(e), 'error')
  } finally {
    removingProviderId.value = null
  }
}

async function checkYggdrasilRuntime() {
  if (checkingRuntime.value) return
  checkingRuntime.value = true
  try {
    const runtime = await prepareYggdrasilRuntime()
    toast(
      `authlib-injector ${runtime.version}（构建 ${runtime.buildNumber}）校验通过 · ${runtime.sha256.slice(0, 12)}…`,
      'success'
    )
  } catch (e) {
    toast('外置登录运行组件准备失败：' + errText(e), 'error')
  } finally {
    checkingRuntime.value = false
  }
}

async function finishYggLogin(result: YggdrasilLoginResult) {
  if (result.status === 'select-profile') {
    Object.assign(profileModal, {
      open: true,
      challengeId: result.challengeId,
      providerName: result.providerName,
      profiles: result.profiles,
      selectedId: result.profiles[0]?.id ?? '',
      busy: false
    })
    return
  }
  yggLogin.password = ''
  await refreshAccounts()
  toast(`外置登录成功，欢迎 ${result.account.username}`, 'success')
}

async function onYggLogin() {
  if (yggLogin.busy) return
  if (!yggLogin.providerId) {
    toast('请先添加并选择认证提供商', 'error')
    return
  }
  if (!yggLogin.identifier.trim() || !yggLogin.password) {
    toast('请输入账号和密码', 'error')
    return
  }
  yggLogin.busy = true
  try {
    await finishYggLogin(
      await loginYggdrasil(yggLogin.providerId, yggLogin.identifier, yggLogin.password)
    )
  } catch (e) {
    toast('外置登录失败：' + errText(e), 'error')
  } finally {
    yggLogin.busy = false
  }
}

async function confirmProfile() {
  if (!profileModal.selectedId || profileModal.busy) return
  profileModal.busy = true
  try {
    const account = await selectYggdrasilProfile(
      profileModal.challengeId,
      profileModal.selectedId
    )
    profileModal.open = false
    yggLogin.password = ''
    await refreshAccounts()
    toast(`已选择角色 ${account.username}`, 'success')
  } catch (e) {
    toast('角色选择失败：' + errText(e), 'error')
  } finally {
    profileModal.busy = false
  }
}

async function onRefreshAccount(account: Account) {
  if (refreshingId.value) return
  refreshingId.value = account.id
  try {
    await refreshAccount(account.id)
    await refreshAccounts()
    toast(`${account.username} 的会话有效`, 'success')
  } catch (e) {
    toast('会话刷新失败：' + errText(e), 'error')
  } finally {
    refreshingId.value = null
  }
}

function accountTypeLabel(account: Account): string {
  if (account.type === 'microsoft') return '微软正版'
  if (account.type === 'yggdrasil') return `外置 · ${account.providerName ?? '未知提供商'}`
  return '离线'
}

onMounted(() => {
  void loadProviders()
  store.yggdrasilImportHandler = openProviderImport
  if (store.pendingYggdrasilImport) {
    const pending = store.pendingYggdrasilImport
    store.pendingYggdrasilImport = null
    openProviderImport(pending)
  }
  offMsDone = onMsLoginDone(async (result) => {
    if (!ms.open) return
    ms.open = false
    ms.waiting = false
    ms.info = null
    const account = result?.account ?? null
    if (account) {
      await refreshAccounts()
      toast(`登录成功，欢迎 ${account.username}`, 'success')
    } else if (result?.error) {
      // 具体失败步骤与原因（设备码/轮询/XBL/XSTS/MC 登录/拥有权/档案），可被查日志诊断
      toast(`微软登录失败：${result.error}`, 'error')
    } else {
      toast('微软登录已取消', 'info')
    }
  })
})

onUnmounted(() => {
  offMsDone?.()
  store.yggdrasilImportHandler = null
  yggLogin.password = ''
})

// ---------------- 账号卡片 ----------------
const removingId = ref<string | null>(null)
const selectingId = ref<string | null>(null)

async function onSelect(acc: Account) {
  if (store.selectedAccount?.id === acc.id) return
  selectingId.value = acc.id
  try {
    store.selectedAccount = await selectAccount(acc.id)
  } catch (e) {
    toast('切换账号失败：' + errText(e), 'error')
  } finally {
    selectingId.value = null
  }
}

async function onRemove(acc: Account) {
  removingId.value = acc.id
  try {
    store.accounts = await removeAccount(acc.id)
    if (store.selectedAccount?.id === acc.id) {
      store.selectedAccount = await getSelectedAccount()
    }
    toast(`已删除账号 ${acc.username}`, 'success')
  } catch (e) {
    toast('删除失败：' + errText(e), 'error')
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <div class="page">
    <!-- 返回 + 标题 -->
    <div class="acc-top">
      <button class="back-btn" @click="store.currentView = 'home'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
        返回首页
      </button>
      <div class="page-head">
        <h1 class="page-title">账号</h1>
        <p class="page-sub">管理微软正版、离线与外置 Yggdrasil 账号</p>
      </div>
    </div>

    <!-- 添加账号 -->
    <div class="card">
      <h3 class="section-title">添加账号</h3>
      <div class="account-type-tabs" role="tablist" aria-label="账号类型">
        <button :class="{ active: accountMode === 'microsoft' }" @click="accountMode = 'microsoft'">
          Microsoft 正版登录
        </button>
        <button :class="{ active: accountMode === 'offline' }" @click="accountMode = 'offline'">
          离线登录
        </button>
        <button :class="{ active: accountMode === 'yggdrasil' }" @click="accountMode = 'yggdrasil'">
          外置 Yggdrasil 登录
        </button>
      </div>

      <div v-if="accountMode === 'microsoft'" class="account-mode-panel">
        <p class="muted mode-description">通过微软设备代码完成正版授权，KAMUCL 不会接触你的微软密码。</p>
        <p class="muted">SSL 证书验证已启用：校验证书链、域名及有效期，证书异常时终止登录。</p>
        <button class="btn btn-gold ms-btn" :disabled="ms.starting" @click="beginMsLogin">
          <span v-if="ms.starting" class="spin"></span>
          <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
          </svg>
          {{ ms.starting ? '正在获取登录码…' : '开始微软登录' }}
        </button>
      </div>

      <div v-else-if="accountMode === 'offline'" class="account-mode-panel add-row">
        <div class="add-input-wrap">
          <input
            v-model="newName"
            class="input"
            :class="{ 'input-error': nameError }"
            placeholder="离线账号用户名（3-16 位字母数字下划线）"
            maxlength="16"
            @keyup.enter="onAddOffline"
          />
          <p v-if="nameError" class="field-error">{{ nameError }}</p>
        </div>
        <button
          class="btn btn-gold add-btn"
          :disabled="adding || !newName || !!nameError"
          @click="onAddOffline"
        >
          {{ adding ? '添加中…' : '添加离线账号' }}
        </button>
      </div>

      <div v-else class="account-mode-panel ygg-panel">
        <div class="provider-head">
          <div>
            <strong>认证提供商</strong>
            <p class="muted mode-description">可输入 API Root，或把皮肤站卡片、URL、JSON/TXT 配置拖到窗口。</p>
          </div>
          <div class="provider-head-actions">
            <button class="btn btn-ghost btn-sm" :disabled="checkingRuntime" @click="checkYggdrasilRuntime">
              {{ checkingRuntime ? '校验中…' : '检查运行组件' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="openProviderImport()">添加提供商</button>
          </div>
        </div>
        <div v-if="providers.length" class="provider-list">
          <div v-for="provider in providers" :key="provider.id" class="provider-item">
            <div>
              <strong>{{ provider.name }}</strong>
              <span v-if="provider.insecure" class="tag tag-danger">HTTP 不安全</span>
              <p class="muted provider-url" :title="provider.apiRoot">{{ provider.apiRoot }}</p>
            </div>
            <button
              class="btn btn-danger btn-sm"
              :disabled="removingProviderId === provider.id"
              @click="onRemoveProvider(provider)"
            >
              删除
            </button>
          </div>
        </div>
        <div v-else class="provider-empty">尚未添加提供商。可直接输入 <code>littleskin.cn</code> 后探测。</div>

        <div class="ygg-login-grid">
          <label>
            <span>提供商</span>
            <select v-model="yggLogin.providerId" class="select">
              <option value="" disabled>请选择提供商</option>
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ provider.name }}
              </option>
            </select>
          </label>
          <label>
            <span>账号或邮箱</span>
            <input v-model="yggLogin.identifier" class="input" autocomplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input
              v-model="yggLogin.password"
              class="input"
              type="password"
              autocomplete="current-password"
              @keyup.enter="onYggLogin"
            />
          </label>
          <button
            class="btn btn-gold ygg-login-btn"
            :disabled="yggLogin.busy || !providers.length"
            @click="onYggLogin"
          >
            {{ yggLogin.busy ? '正在认证…' : '登录' }}
          </button>
        </div>
        <p class="security-note">密码只用于本次认证请求，不会保存；令牌由 Windows 安全存储加密。</p>
      </div>
    </div>

    <!-- 账号列表 -->
    <div class="card">
      <h3 class="section-title">我的账号（{{ store.accounts.length }}）</h3>
      <div v-if="!store.accounts.length" class="empty list-empty">
        <span>还没有账号，先添加一个离线账号或登录微软账号吧</span>
      </div>
      <div v-else class="account-list">
        <div
          v-for="acc in store.accounts"
          :key="acc.id"
          class="account-row"
          :class="{ selected: store.selectedAccount?.id === acc.id }"
          @click="onSelect(acc)"
        >
          <Avatar :account="acc" :size="42" />
          <div class="account-meta">
            <div class="account-name">
              {{ acc.username }}
              <span
                class="tag"
                :class="acc.type === 'microsoft' ? 'tag-gold' : acc.type === 'yggdrasil' ? 'tag-cyan' : ''"
              >
                {{ accountTypeLabel(acc) }}
              </span>
            </div>
            <span class="muted uuid">{{ acc.uuid.slice(0, 8) }}</span>
          </div>
          <span v-if="store.selectedAccount?.id === acc.id" class="selected-badge">使用中</span>
          <span v-else-if="selectingId === acc.id" class="spin"></span>
          <button
            v-if="acc.type === 'yggdrasil'"
            class="btn btn-ghost btn-sm"
            :disabled="refreshingId === acc.id"
            @click.stop="onRefreshAccount(acc)"
          >
            {{ refreshingId === acc.id ? '验证中…' : '验证会话' }}
          </button>
          <button
            class="btn btn-danger btn-sm remove-btn"
            :disabled="removingId === acc.id"
            @click.stop="onRemove(acc)"
          >
            {{ removingId === acc.id ? '删除中…' : '删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 微软登录模态框 -->
    <Teleport to="body">
      <div v-if="ms.open" class="modal-mask">
        <div class="modal ms-modal">
          <h3 class="modal-title">微软账号登录</h3>
          <p class="muted ms-tip">
            请在浏览器中打开验证地址，输入下方代码完成授权。登录成功后本窗口会自动关闭。
          </p>

          <button class="user-code" title="点击复制" @click="copyCode">
            {{ ms.info?.userCode }}
          </button>
          <p v-if="ms.autoCopied" class="copy-hint copied">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            已自动复制到剪贴板，到验证页直接粘贴即可
          </p>
          <p v-else class="muted copy-hint">点击代码即可复制</p>

          <div class="ms-uri-row">
            <input class="input" :value="ms.info?.verificationUri" readonly />
            <button class="btn btn-gold" @click="openVerifyPage">打开验证页面</button>
          </div>

          <div v-if="ms.waiting" class="ms-waiting">
            <span class="spin"></span>
            <span class="muted">正在等待授权完成…</span>
          </div>

          <div class="modal-actions">
            <button class="btn btn-ghost" @click="cancelMsLogin">取消登录</button>
          </div>
        </div>
      </div>

      <!-- 外置登录提供商探测与确认 -->
      <div v-if="providerModal.open" class="modal-mask" @pointerdown.self="providerModal.open = false">
        <div class="modal provider-modal">
          <h3 class="modal-title">添加外置登录提供商</h3>
          <p class="muted ms-tip">支持 API Root、authlib-injector 拖拽 URI，以及 KAMUCL 提供商 JSON/TXT 文件。</p>
          <label class="provider-input-label">
            <span>API Root 或配置内容</span>
            <textarea
              v-model="providerModal.source"
              class="input provider-source"
              :readonly="providerModal.input?.kind === 'file'"
              placeholder="例如：https://littleskin.cn/api/yggdrasil"
              spellcheck="false"
            ></textarea>
          </label>
          <label v-if="providerModal.requireInsecure" class="insecure-confirm">
            <input v-model="providerModal.allowInsecure" type="checkbox" />
            <span>我了解 HTTP 会以明文传输账号与密码，仍要连接该服务</span>
          </label>
          <p v-if="providerModal.error" class="provider-error">{{ providerModal.error }}</p>
          <div v-if="providerModal.candidate" class="provider-preview">
            <div><span>名称</span><strong>{{ providerModal.candidate.name }}</strong></div>
            <div><span>API Root</span><code>{{ providerModal.candidate.apiRoot }}</code></div>
            <div><span>Auth Server</span><code>{{ providerModal.candidate.authServer }}</code></div>
            <div><span>Account Server</span><code>{{ providerModal.candidate.accountServer }}</code></div>
            <div><span>Session Server</span><code>{{ providerModal.candidate.sessionServer }}</code></div>
            <div><span>Skin Domains</span><code>{{ providerModal.candidate.skinDomains.join(', ') || '未声明' }}</code></div>
            <p v-if="providerModal.candidate.aliRedirected" class="ali-note">已按 ALI 标头解析到实际 API Root。</p>
          </div>
          <div class="modal-actions provider-actions">
            <button class="btn btn-ghost" @click="providerModal.open = false">取消</button>
            <button class="btn btn-ghost" :disabled="providerModal.probing" @click="probeProviderInput">
              {{ providerModal.probing ? '正在获取元数据…' : '识别并校验' }}
            </button>
            <button
              class="btn btn-gold"
              :disabled="!providerModal.candidate || providerModal.saving"
              @click="confirmProvider"
            >
              {{ providerModal.saving ? '保存中…' : '确认保存' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 多角色选择 -->
      <div v-if="profileModal.open" class="modal-mask">
        <div class="modal profile-modal">
          <h3 class="modal-title">选择 {{ profileModal.providerName }} 角色</h3>
          <p class="muted ms-tip">此账号拥有多个角色，请选择本次要保存并启动的角色。</p>
          <div class="profile-options">
            <label
              v-for="profile in profileModal.profiles"
              :key="profile.id"
              :class="{ selected: profileModal.selectedId === profile.id }"
            >
              <input v-model="profileModal.selectedId" type="radio" :value="profile.id" />
              <span>{{ profile.name }}</span>
              <code>{{ profile.id.slice(0, 8) }}</code>
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="profileModal.open = false">取消</button>
            <button class="btn btn-gold" :disabled="profileModal.busy" @click="confirmProfile">
              {{ profileModal.busy ? '正在选择…' : '使用此角色' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--sec-gap);
  max-width: 720px;
  margin: 0 auto;
}

.acc-top {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.back-btn:hover {
  background: var(--card-2);
  color: var(--accent-2);
}
.back-btn svg {
  width: 15px;
  height: 15px;
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 700;
  margin: 0 0 var(--space-3);
  line-height: 1.5;
}

.account-type-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.account-type-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--ctl-h);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.account-type-tabs button:hover {
  color: var(--text);
}
.account-type-tabs button.active {
  color: var(--on-accent);
  background: var(--accent-grad);
  font-weight: 600;
}
.account-mode-panel {
  margin-top: var(--space-4);
}
.mode-description {
  margin-bottom: var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.6;
}

/* 添加账号 */
.add-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
.add-input-wrap {
  flex: 1;
  min-width: 0;
}
.input-error {
  border-color: var(--danger);
}
.field-error {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--danger);
}
.add-btn,
.ms-btn {
  flex-shrink: 0;
}
.ygg-panel {
  display: grid;
  gap: var(--space-4);
}
.provider-head,
.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.provider-head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}
.provider-head .mode-description {
  margin: var(--space-1) 0 0;
}
.provider-list {
  display: grid;
  gap: var(--space-2);
}
.provider-item {
  min-height: var(--row-h);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.provider-item strong {
  margin-right: var(--space-2);
  font-size: var(--text-sm);
}
.provider-url {
  max-width: 520px;
  margin-top: var(--space-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--text-xs) 'Cascadia Code', Consolas, monospace;
}
.provider-empty {
  padding: var(--space-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--text-xs);
  text-align: center;
}
.ygg-login-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.ygg-login-grid label {
  display: grid;
  gap: var(--space-2);
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.ygg-login-grid label:first-child {
  grid-column: 1 / -1;
}
.ygg-login-btn {
  align-self: end;
  min-height: var(--ctl-h);
}
.security-note {
  color: var(--ok);
  font-size: var(--text-xs);
}

/* 账号列表 */
.list-empty {
  padding: var(--space-6) var(--space-5);
}
.account-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.account-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}
.account-row:hover {
  border-color: var(--accent-deep);
}
.account-row.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: 800;
  color: var(--on-accent);
  background: var(--accent-grad);
  flex-shrink: 0;
}
.account-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  flex: 1;
}
.account-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
}
.uuid {
  font-size: var(--text-xs);
  font-family: 'Cascadia Code', Consolas, monospace;
}
.selected-badge {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  color: var(--accent);
  flex-shrink: 0;
}
.remove-btn {
  flex-shrink: 0;
}

/* 微软登录模态框 */
.ms-modal {
  text-align: center;
}
.modal-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0 0 var(--space-3);
}
.ms-tip {
  font-size: var(--text-sm);
  line-height: 1.6;
}
.user-code {
  margin: var(--space-4) auto var(--space-2);
  padding: var(--space-4) var(--space-5);
  border: 1px dashed var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent-2);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.user-code:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.copy-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  margin-bottom: var(--space-4);
}
.copy-hint.copied {
  color: var(--ok);
}
.ms-uri-row {
  display: flex;
  gap: var(--space-3);
}
.ms-uri-row .input {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
}
.ms-uri-row .btn {
  flex-shrink: 0;
}
.ms-waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
}
.provider-modal {
  width: min(620px, calc(100vw - 40px));
}
.provider-input-label {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
  color: var(--text-dim);
  font-size: var(--text-xs);
}
.provider-source {
  min-height: 84px;
  resize: vertical;
  font: var(--text-xs)/1.55 'Cascadia Code', Consolas, monospace;
}
.insecure-confirm {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--danger) 50%, var(--border));
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.provider-error {
  margin-top: var(--space-3);
  color: var(--danger);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.provider-preview {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
}
.provider-preview > div {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: var(--space-2);
  font-size: var(--text-xs);
}
.provider-preview span {
  color: var(--text-dim);
}
.provider-preview code,
.profile-options code {
  overflow-wrap: anywhere;
  color: var(--text);
  font: var(--text-xs) 'Cascadia Code', Consolas, monospace;
}
.ali-note {
  color: var(--ok);
  font-size: var(--text-xs);
}
.provider-actions {
  justify-content: flex-end;
}
.profile-options {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
.profile-options label {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-2);
  cursor: pointer;
}
.profile-options label.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 680px) {
  .account-type-tabs,
  .ygg-login-grid {
    grid-template-columns: 1fr;
  }
  .ygg-login-grid label:first-child {
    grid-column: auto;
  }
  .add-row {
    flex-direction: column;
  }
  .add-btn {
    width: 100%;
  }
}
</style>
