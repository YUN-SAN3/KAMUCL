<script setup lang="ts">
import { ref } from 'vue'
import { store, toast } from '../store'
import { saveSettings, errText } from '../api'
import type { MemoryOrganizeResult } from '@shared/memoryOrganizer'
const emit=defineEmits<{refresh:[]}>(),busy=ref(false),result=ref<MemoryOrganizeResult>()
const windows=window.kamucl.platform==='win32'
async function run(){if(busy.value)return;busy.value=true;try{result.value=await window.kamucl.invoke('memory:organize') as MemoryOrganizeResult;emit('refresh')}catch(e){toast(errText(e),'error')}finally{busy.value=false}}
async function toggle(e:Event){const on=(e.target as HTMLInputElement).checked;try{await saveSettings({memoryOrganizeBeforeLaunch:on});store.settings!.memoryOrganizeBeforeLaunch=on}catch(e){toast(errText(e),'error')}}
</script>
<template><div class="memory-organizer"><template v-if="windows"><div class="organizer-actions"><button class="btn btn-ghost btn-sm" :disabled="busy" @click="run">{{busy?'正在整理…':'整理系统内存'}}</button><label><input :checked="store.settings?.memoryOrganizeBeforeLaunch===true" type="checkbox" @change="toggle">启动前整理</label></div><p class="muted">整理可回收工作集；运行中的游戏和受保护进程会跳过。内存可能随进程活动回涨。</p><p v-if="result" role="status">可用 {{result.beforeMB}} → {{result.afterMB}} MB · 处理 {{result.processed}} · 跳过 {{result.skipped}} · {{(result.elapsedMs/1000).toFixed(1)}} 秒</p><details v-if="result&&Object.keys(result.failures).length"><summary>跳过或失败原因</summary><p v-for="(count,reason) in result.failures" class="muted">{{reason}}：{{count}}</p></details></template><p v-else class="muted">系统工作集整理仅适用于 Windows；本机可继续查看内存信息及设置游戏分配。</p></div></template>
<style scoped>.memory-organizer{border-top:1px solid var(--border);margin-top:16px;padding-top:12px;font-size:13px}.organizer-actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px}.memory-organizer p{line-height:1.6}</style>
