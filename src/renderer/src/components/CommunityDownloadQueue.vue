<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useCommunityDownloadQueue } from '../useCommunityDownloadQueue'
import { modProgressPercent } from '../modInstallProgress'
import type { CommunityDownloadState } from '../communityDownloadQueue'
import CommunityInstallConfirmation from './CommunityInstallConfirmation.vue'
const queue = useCommunityDownloadQueue()
const expanded = ref(true), reviewing = ref(''), actionError = ref('')
const panel = ref<HTMLElement | null>(null)
const active = computed(() => queue.items.filter(item => !['completed','failed','cancelled'].includes(item.state)).length)
const confirmations = computed(() => queue.items.filter(item => item.state === 'confirmation').length)
const reviewed = computed(() => queue.items.find(item => item.id === reviewing.value && item.state === 'confirmation'))
const labels: Record<CommunityDownloadState,string> = { queued:'排队中', preparing:'预下载与检测', confirmation:'等待确认前置', installing:'下载前置与安装', downloading:'下载中', 'installing-pack':'安装整合包', completed:'完成', failed:'失败', cancelled:'已取消' }
async function cancel(id: string) { actionError.value = ''; try { await queue.cancel(id) } catch (e) { actionError.value = String(e) } }
async function recheck(id: string) { actionError.value = ''; try { await queue.recheck(id); reviewing.value = '' } catch (e) { actionError.value = String(e) } }
function showQueue() { expanded.value = true; void nextTick(() => panel.value?.scrollIntoView({ block:'start', behavior:'smooth' })) }
</script>
<template>
  <div v-if="active || confirmations" class="queue-shortcut-bar">
    <button class="btn btn-gold queue-shortcut" data-ui="community:queue-shortcut" @click="showQueue">社区队列 · {{ active }}<template v-if="confirmations"> · 待确认 {{ confirmations }}</template></button>
  </div>
  <section v-if="queue.items.length" ref="panel" class="card community-queue" aria-label="社区下载队列" data-ui="community:download-queue">
    <button class="queue-head btn btn-ghost" :aria-expanded="expanded" @click="expanded = !expanded"><strong>社区下载队列 · {{ active }} 个进行中</strong><span>{{ confirmations ? confirmations + ' 个等待确认' : '顶部“下载”同步显示进度' }} · {{ expanded ? '收起' : '展开' }}</span></button>
    <div v-if="expanded" class="queue-items">
      <article v-for="item in queue.items" :key="item.id" class="queue-item" :data-state="item.state">
        <div class="queue-info"><strong class="queue-name" :title="item.file.fileName">{{ item.file.fileName }}</strong><small>{{ item.target?.id || '新整合包实例' }} · {{ item.folder }}</small><p role="status">{{ labels[item.state] }}<template v-if="item.progress && ['preparing','installing','downloading','installing-pack'].includes(item.state)"> · {{ modProgressPercent(item.progress) == null ? '处理中…' : modProgressPercent(item.progress) + '%' }} · {{ item.progress.text }}</template><template v-if="item.error"> · {{ item.error }}</template></p></div>
        <div class="queue-actions"><button v-if="item.state === 'confirmation'" class="btn btn-gold btn-sm" @click="reviewing = item.id">确认前置与安装</button><button v-if="['failed','cancelled'].includes(item.state)" class="btn btn-gold btn-sm" @click="queue.retry(item.id)">重试</button><button v-if="!['completed','failed','cancelled'].includes(item.state)" class="btn btn-ghost btn-sm" :disabled="item.cancelRequested" @click="cancel(item.id)">{{ item.cancelRequested ? '正在取消…' : '取消' }}</button><button v-else class="btn btn-ghost btn-sm" @click="queue.dismiss(item.id)">清除记录</button></div>
      </article>
      <p v-if="actionError" class="modal-error">{{ actionError }}</p>
    </div>
    <CommunityInstallConfirmation v-if="reviewed" :key="reviewed.id" :item="reviewed" @close="reviewing = ''" @confirm="queue.confirm(reviewed!.id); reviewing = ''" @recheck="recheck(reviewed!.id)" />
  </section>
</template>
<style scoped>
.community-queue { margin-bottom:var(--space-5); padding:var(--space-3); scroll-margin-top:80px; }
.queue-shortcut-bar { position:sticky; top:0; z-index:20; grid-column:1/-1; display:flex; justify-content:flex-end; padding:var(--space-2); background:var(--card-solid); border:1px solid var(--border); border-radius:var(--radius-md); }
.queue-shortcut { box-shadow:var(--shadow-md); font-size:var(--text-xs); }
.queue-head { display:flex; width:100%; justify-content:space-between; flex-wrap:wrap; gap:var(--space-2); text-align:left; }
.queue-head span { font-size:var(--text-xs); color:var(--text-dim); }
.queue-items { max-height:280px; overflow:auto; }
.queue-item { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3); border-top:1px solid var(--border); }
.queue-info { min-width:0; flex:1; }
.queue-name { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--text-sm); }
.queue-info small, .queue-info p { display:block; font-size:var(--text-xs); line-height:1.6; color:var(--text-dim); overflow-wrap:anywhere; margin:3px 0 0; }
.queue-item[data-state="failed"] .queue-info p { color:var(--danger); }
.queue-actions { display:flex; flex-wrap:wrap; gap:var(--space-2); flex:none; }
@media(max-width:640px) { .queue-item { align-items:stretch; flex-direction:column; } .queue-actions { justify-content:flex-end; } }
</style>
