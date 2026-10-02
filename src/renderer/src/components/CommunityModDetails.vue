<script setup lang="ts">
import { ref, watch } from 'vue'
import { communityProject, errText } from '../api'
import type { CommunityModProject, CommunityProjectReference } from '@shared/types'

const props = defineProps<{ reference: CommunityProjectReference }>()
const emit = defineEmits<{ (event:'close'):void; (event:'download',project:CommunityProjectReference):void }>()
const project = ref<CommunityModProject>(), loading = ref(false), error = ref(''), retry = ref(0)
watch([() => props.reference.source, () => props.reference.projectId, retry], async (_next, _old, cleanup) => {
  let stale = false; cleanup(() => { stale = true })
  loading.value = true; error.value = ''; project.value = undefined
  try { const result = await communityProject(props.reference.source, props.reference.projectId); if (!stale) project.value = result }
  catch (reason) { if (!stale) error.value = errText(reason) }
  finally { if (!stale) loading.value = false }
}, { immediate:true })
const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('zh-CN') }
function openSource() { if (project.value?.webpage) window.open(project.value.webpage, '_blank') }
function download() { if (project.value) emit('download', project.value) }
</script>

<template>
  <Teleport to="body"><div class="modal-mask" @pointerdown.self="emit('close')" @keydown.esc.prevent="emit('close')"><section class="modal community-project-modal" role="dialog" aria-modal="true" aria-labelledby="community-project-title" data-ui="community:project-details" :aria-busy="loading">
    <header class="project-heading"><div><span class="project-platform muted">{{ reference.source === 'modrinth' ? 'Modrinth' : 'CurseForge' }} · MOD 详情</span><h3 id="community-project-title" class="modal-title">{{ project?.title || reference.title }}</h3></div><button class="icon-btn" data-modal-dismiss aria-label="关闭模组详情" @click="emit('close')">×</button></header>
    <div v-if="loading" class="project-loading muted" role="status"><span class="spin" />正在读取来源项目资料…</div>
    <div v-else-if="error" class="project-error" role="alert"><p>{{ error }}</p><button class="btn btn-ghost btn-sm" @click="retry++">重试</button></div>
    <template v-else-if="project">
      <p v-if="project.description" class="project-summary" data-ui="community:project-summary">{{ project.description }}</p><p v-else class="muted project-summary">来源平台未提供摘要。</p>
      <dl class="project-facts"><div><dt>项目 ID</dt><dd>{{ project.projectId }}</dd></div><div v-if="project.author"><dt>作者</dt><dd>{{ project.author }}</dd></div><div v-if="project.license"><dt>许可证</dt><dd>{{ project.license }}</dd></div><div v-if="project.downloads !== undefined" data-ui="community:project-downloads"><dt>下载量</dt><dd>{{ project.downloads.toLocaleString('zh-CN') }}</dd></div><div v-if="project.followers !== undefined"><dt>关注人数</dt><dd>{{ project.followers.toLocaleString('zh-CN') }}</dd></div><div v-if="project.updatedAt && date(project.updatedAt)"><dt>更新日期</dt><dd>{{ date(project.updatedAt) }}</dd></div></dl>
      <div v-if="project.categories.length" class="project-categories" aria-label="项目类别"><span v-for="category in project.categories" :key="category" class="tag">{{ category }}</span></div>
    </template>
    <footer class="modal-actions"><button v-if="project?.webpage" class="btn btn-ghost project-source" @click="openSource">打开来源页面 ↗</button><button class="btn btn-ghost" data-modal-dismiss @click="emit('close')">关闭</button><button v-if="project" class="btn btn-gold project-download" @click="download">选择版本并安装</button></footer>
  </section></div></Teleport>
</template>

<style scoped>
.community-project-modal { width:min(620px,calc(100vw - 32px));max-height:85vh;overflow-y:auto;padding:24px; }
.project-heading { display:flex;align-items:flex-start;justify-content:space-between;gap:16px; }.project-heading>div{min-width:0}.project-heading .icon-btn{flex:none}
.project-platform{font-size:11px}.modal-title{margin:6px 0 0;font-size:20px;line-height:1.5;overflow-wrap:anywhere}.project-loading{display:flex;align-items:center;gap:10px;padding:28px 0;font-size:13px}.project-error{color:var(--danger);font-size:13px;line-height:1.7}
.project-summary{font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:20px 0}.project-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 24px;margin:20px 0;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.project-facts>div{min-width:0}.project-facts dt{font-size:11px;color:var(--text-dim);margin-bottom:5px}.project-facts dd{margin:0;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.project-categories{display:flex;flex-wrap:wrap;gap:6px}.project-categories .tag{font-size:11px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:24px}.project-source{margin-right:auto}
@media(max-width:600px){.community-project-modal{padding:20px}.project-facts{gap:12px}.modal-title{font-size:18px}}
</style>
