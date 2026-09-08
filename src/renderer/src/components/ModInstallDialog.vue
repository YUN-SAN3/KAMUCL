<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { CommunityFile, InstalledVersion, ModInstallPlan } from '@shared/types'
import { prepareModInstall, commitModInstall, discardModInstall, errText } from '../api'
import { store, toast } from '../store'
import MarqueeText from './MarqueeText.vue'
const props = defineProps<{ target: InstalledVersion; input: { paths?: string[]; file?: CommunityFile } }>()
const emit = defineEmits<{ close: []; installed: [] }>()
const plan = ref<ModInstallPlan>(), busy = ref(true), error = ref('')
let disposed = false
onMounted(async () => {
  try {
    const result = await prepareModInstall({ id: props.target.id, folder: props.target.folder! }, props.input)
    if (disposed) { void discardModInstall(result.id); return }
    plan.value = result
  } catch (e) { error.value = errText(e) }
  finally { busy.value = false }
})
onUnmounted(() => { disposed = true; if (plan.value) void discardModInstall(plan.value.id) })
async function install() {
  if (!plan.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const message = await commitModInstall(plan.value.id, true)
    toast(message, 'success'); store.fsRefreshTick++; emit('installed')
  } catch (e) { error.value = errText(e); plan.value = undefined }
  finally { busy.value = false }
}
</script>
<template>
  <Teleport to="body"><div class="modal-mask" style="z-index: 10020" @pointerdown.self="!busy && emit('close')">
    <section class="modal modinstall-modal" role="dialog" aria-modal="true" aria-label="安装 MOD 与前置">
      <h3 class="modal-title">安装 MOD 与前置</h3>
      <p class="muted modinstall-sub">{{ target.id }} · MC {{ target.mcVersion }} · {{ target.loader }} {{ target.loaderVersion }}<br>{{ target.folder }}</p>
      <div v-if="busy" class="modal-loading"><span class="spin"></span><span class="muted">{{ plan ? '正在下载、校验并安装…' : '正在读取 MOD 元数据与递归前置关系…' }}</span></div>
      <template v-if="plan">
        <div v-for="f in plan.files" :key="f.fileName" class="dependency-row"><span class="tag">{{ f.dependency ? '缺失前置' : '所选 MOD' }}</span><div class="dependency-name"><MarqueeText :text="f.fileName"/><MarqueeText :text="f.version"/></div></div>
        <p v-if="plan.missing.length" class="muted modal-note">元数据要求：{{ plan.missing.join('、') }}</p>
        <p v-for="warning in plan.warnings" :key="warning" class="modal-error">{{ warning }}</p>
        <p class="modal-note">是否一键下载缺失前置并安装？已有兼容前置将复用；若检测到冲突，将停止且不覆盖原文件。</p>
      </template>
      <p v-if="error" class="modal-error">{{ error }}</p>
      <div class="modal-actions"><button class="btn btn-ghost" :disabled="busy" @click="emit('close')">{{ error ? '关闭并重新选择' : '取消' }}</button><button v-if="plan" class="btn btn-gold" :disabled="busy || !!plan.warnings.length" @click="install">{{ plan.files.some(f => f.dependency) ? '一键下载前置并安装' : '确认安装' }}</button></div>
    </section>
  </div></Teleport>
</template>
<style scoped>
.modinstall-modal {
  width: min(640px, calc(100vw - 40px));
  max-height: 85vh;
  overflow-y: auto;
}
.modal-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin: 0 0 var(--space-2);
}
.modinstall-sub {
  font-size: var(--text-xs);
  margin: 0;
  line-height: 1.6;
  word-break: break-all;
}
.modal-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}
.dependency-row { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
.dependency-name { min-width: 0; flex: 1; }
.modal-note { font-size: var(--text-sm); line-height: 1.6; color: var(--text-dim); }
.modal-error { color: var(--danger); white-space: pre-wrap; font-size: var(--text-sm); }
.modal-actions { display: flex; align-items: center; gap: var(--space-3); justify-content: flex-end; margin-top: var(--space-5); }
</style>
