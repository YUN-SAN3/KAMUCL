<script setup lang="ts">
import { ref } from 'vue'
import type { ManualModpackRequest } from '@shared/types'
import { supplyModpackFiles, openModpackFile, errText } from '../api'
const props = defineProps<{ request: ManualModpackRequest; paused?: boolean }>()
const busy = ref(false), message = ref('')
async function supply() {
  busy.value = true; message.value = ''
  try {
    const result = await supplyModpackFiles(props.request.token)
    message.value = result.rejected.length ? `已补充 ${result.accepted} 个；以下文件与所需版本不匹配：${result.rejected.join('、')}` : `已补充 ${result.accepted} 个，剩余 ${result.remaining} 个`
  } catch (error) { message.value = errText(error) } finally { busy.value = false }
}
async function open(fileID: number) {
  try { await openModpackFile(props.request.token, fileID) } catch (error) { message.value = errText(error) }
}
</script>
<template>
  <section class="pack-supplement" data-ui="download.modpack-supplement">
    <strong>需要补充 {{ request.files.length }} 个文件</strong>
    <p>已检查包内文件、本地游戏目录与可用下载来源，仍未找到以下文件的对应版本。可选择已有文件继续安装；其他下载仍会进行。</p>
    <div class="supplement-list">
      <div v-for="file in request.files" :key="file.fileID" class="supplement-row">
        <span :title="file.fileName">{{ file.fileName }}</span>
        <button class="btn btn-ghost btn-sm" @click="open(file.fileID)">文件页面 ↗</button>
      </div>
    </div>
    <button class="btn btn-gold btn-sm" :disabled="busy || paused" @click="supply">{{ busy ? '正在校验…' : '选择已下载文件…' }}</button>
    <p v-if="message" role="status">{{ message }}</p>
    <small>支持一次选择多个文件，仅接受大小及 SHA1 一致的版本。</small>
  </section>
</template>
<style scoped>
.pack-supplement{padding:14px;margin-top:12px;border:1px solid var(--border-strong);border-radius:12px;background:var(--card);font-size:13px}.pack-supplement p{margin:8px 0;line-height:1.5;color:var(--text-dim);overflow-wrap:anywhere}.pack-supplement small{display:block;margin-top:8px;color:var(--text-dim)}.supplement-list{max-height:210px;overflow:auto;overscroll-behavior:contain;margin:10px 0}.supplement-row{display:flex;align-items:center;gap:10px;min-height:46px;padding:5px 0;border-bottom:1px solid var(--border)}.supplement-row span{min-width:0;flex:1;overflow-wrap:anywhere}.supplement-row button{flex-shrink:0}
</style>
