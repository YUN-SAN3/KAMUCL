<script setup lang="ts">
import {ref,onMounted,onUnmounted} from 'vue'
import type {SupplementalFailure} from '@shared/supplementalMods'
import {store,toast,refreshInstalled} from '../store'
import {errText} from '../api'
import UpdateDialogShell from './UpdateDialogShell.vue'
const pending=ref<SupplementalFailure[]>([]),busy=ref(false),error=ref(''),hidden=ref(false)
const off=window.kamucl.on('mods:supplementalPending',(list:SupplementalFailure[])=>{pending.value=list;hidden.value=false})
onMounted(async()=>{try{pending.value=await window.kamucl.invoke('mods:supplementalList')}catch(e){toast(errText(e),'error')}})
onUnmounted(off)
async function act(retry:boolean){const entry=pending.value[0];if(!entry||busy.value)return;busy.value=true;error.value=''
 try{pending.value=await window.kamucl.invoke(retry?'mods:supplementalRetry':'mods:supplementalKeep',entry.id);store.failedInstalls.delete(entry.versionId);store.fsRefreshTick++;await refreshInstalled();toast(retry?'附加模组已安装完成':'已保留基础实例，可正常启动','success')}
 catch(e){error.value=errText(e)}finally{busy.value=false}
}
</script>
<template><button v-if="pending.length&&hidden" class="btn btn-ghost supplemental-pending" @click="hidden=false">附加模组待处理（{{pending.length}}）</button><UpdateDialogShell v-if="pending.length&&!hidden" label="附加模组未完成" @dismiss="!busy&&(hidden=true)"><section class="supplemental-result">
 <h2>基础实例已保留</h2><p>{{pending[0].target.id}} 已安装，但所选模组没有全部完成。</p><p class="failure" role="alert">{{error||pending[0].message}}</p><p class="muted">重试会重新校验版本与依赖。保留基础实例后可照常启动，已有用户模组会保留。</p>
 <div class="actions"><button class="btn btn-gold" :disabled="busy" @click="act(true)">{{busy?'处理中…':'重试附加模组'}}</button><button class="btn btn-ghost" :disabled="busy" @click="act(false)">保留基础实例</button><button class="btn btn-ghost" :disabled="busy" @click="hidden=true">稍后处理</button></div>
 </section></UpdateDialogShell></template>
<style scoped>.supplemental-pending{position:fixed;bottom:14px;right:18px;z-index:100;background:var(--card);border:1px solid var(--border)}.supplemental-result{max-width:560px;padding:26px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.failure{color:var(--danger);overflow-wrap:anywhere}</style>
