<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CommunityProjectReference } from '@shared/types'
import type { CommunityDownloadItem } from '../communityDownloadQueue'
import CommunityModDetails from './CommunityModDetails.vue'
import MarqueeText from './MarqueeText.vue'
const props = defineProps<{ item: CommunityDownloadItem }>()
const emit = defineEmits<{ close: []; confirm: []; recheck: [] }>()
const includeDependencies = ref(true)
const detail = ref<CommunityProjectReference | null>(null)
const dependencies = computed(() => props.item.plan?.files.filter(file => file.dependency) ?? [])
const canInstall = computed(() => !!props.item.plan && !props.item.plan.warnings.length && (!dependencies.value.length || includeDependencies.value))
</script>
<template>
  <Teleport to="body"><div class="modal-mask" style="z-index:10020" @pointerdown.self="emit('close')">
    <section class="modal community-confirm" role="dialog" aria-modal="true" aria-label="安装 MOD 与前置">
      <h3 class="modal-title">安装 MOD 与前置</h3>
      <p class="muted target">{{ item.target?.id }} · MC {{ item.target?.mcVersion }} · {{ item.target?.loader }} {{ item.target?.loaderVersion }}<br>{{ item.folder }}</p>
      <template v-if="item.plan">
        <div v-for="file in item.plan.files" :key="file.fileName" class="dependency-row"><span class="tag">{{ file.dependency ? '待安装前置' : '所选 MOD' }}</span><div class="dependency-name"><MarqueeText :text="file.fileName"/><MarqueeText :text="file.version"/></div><button v-if="file.dependency && file.source && file.projectId" class="btn btn-ghost btn-sm" @click="detail = { source:file.source, projectId:file.projectId, title:file.fileName }">查看项目</button></div>
        <p v-if="item.plan.missing.length" class="muted modal-note">元数据要求：{{ item.plan.missing.join('、') }}</p>
        <p v-for="warning in item.plan.warnings" :key="warning" class="modal-error">{{ warning }}</p>
        <label v-if="dependencies.length" class="dependency-choice"><input v-model="includeDependencies" type="checkbox"><span>同时下载 {{ dependencies.length }} 个必要前置<small>与 MC {{ item.target?.mcVersion }} / {{ item.target?.loader }} 匹配，递归检测并校验后一起安装。</small></span></label>
        <p v-if="dependencies.length && !includeDependencies" class="modal-error">必要前置仍未准备好，暂不写入所选 MOD。请先自行安装前置，再重新检测；也可勾选后一起下载。</p>
        <p class="modal-note">已有兼容前置将复用；无法查询、没有兼容版本或出现冲突时会停止。确认后后台下载和安装，可继续浏览资源。</p>
      </template>
      <div class="modal-actions"><button class="btn btn-ghost" @click="emit('close')">稍后确认</button><button v-if="item.plan?.warnings.length || !includeDependencies" class="btn btn-ghost" @click="emit('recheck')">重新检测</button><button class="btn btn-gold" :disabled="!canInstall" @click="emit('confirm')">{{ dependencies.length ? '下载前置并安装' : '确认安装' }}</button></div>
    </section>
  </div></Teleport>
  <CommunityModDetails v-if="detail" :reference="detail" :allow-download="false" @close="detail = null" />
</template>
<style scoped>
.community-confirm { width:min(640px,calc(100vw - 40px)); max-height:85vh; overflow-y:auto; }
.modal-title { font-size:var(--text-lg); margin:0 0 var(--space-2); }
.target { font-size:var(--text-xs); line-height:1.6; overflow-wrap:anywhere; }
.dependency-row { display:flex; align-items:center; gap:var(--space-3); min-height:48px; padding:var(--space-2) 0; border-bottom:1px solid var(--border); }
.dependency-name { min-width:0; flex:1; }
.dependency-name :last-child { font-size:var(--text-xs); color:var(--text-dim); }
.dependency-choice { display:flex; gap:var(--space-2); margin:var(--space-4) 0; font-size:var(--text-sm); }
.dependency-choice small { display:block; margin-top:4px; color:var(--text-dim); }
.modal-note { font-size:var(--text-xs); line-height:1.6; color:var(--text-dim); }
</style>
