<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CommunityFile, InstallOptions, LoaderName } from '@shared/types'
import type { ModFavorite } from '@shared/modFavorites'
import SelectMenu from './SelectMenu.vue'
import { errText } from '../api'
import { favorites, loadFavorites } from '../modFavorites'
const props=defineProps<{mc:string;loader:''|LoaderName;modelValue?:InstallOptions['favoriteMods']}>()
const emit=defineEmits<{'update:modelValue':[InstallOptions['favoriteMods']];ready:[boolean]}>()
const enabled=ref(false), rows=ref<{favorite:ModFavorite;files:CommunityFile[];selected:string;checked:boolean;error:string}[]>([]),busy=ref(false),error=ref(''),retry=ref(0)
function update(){emit('update:modelValue',enabled.value?rows.value.filter(r=>r.checked&&r.selected&&r.favorite.source&&r.favorite.projectId).map(r=>({source:r.favorite.source!,projectId:r.favorite.projectId!,fileId:r.selected})):undefined);emit('ready',!enabled.value||(!busy.value&&!error.value&&!rows.value.some(r=>r.checked&&!r.selected)))}
watch([()=>props.mc,()=>props.loader,enabled,retry,()=>JSON.stringify(favorites.value.map(f=>[f.key,f.name,f.source,f.projectId]))],async(_n,_o,cleanup)=>{
  let stale=false;cleanup(()=>{stale=true});rows.value=[];error.value='';busy.value=enabled.value;emit('update:modelValue',undefined);emit('ready',!enabled.value)
  if(!enabled.value)return
  try{await loadFavorites(true);if(stale)return
    rows.value=favorites.value.map(favorite=>({favorite,files:[],selected:'',checked:false,error:favorite.source?'':'来源未关联，无法自动下载'}))
    if(!props.loader){error.value='请先选择模组加载器';return}
    await Promise.all(rows.value.map(async row=>{if(!row.favorite.source||!row.favorite.projectId)return;try{const files=await window.kamucl.invoke('mods:favoriteVersions',row.favorite.source,row.favorite.projectId,props.mc,props.loader) as CommunityFile[];if(stale)return;row.files=files;row.selected=files.find(f=>f.releaseType==='release')?.fileId||files[0]?.fileId||'';row.checked=!!row.selected;row.error=files.length?'':'没有兼容的文件'}catch(e){if(!stale)row.error=errText(e)}}))
  }catch(e){if(!stale)error.value=errText(e)}finally{if(!stale){busy.value=false;update()}}
},{immediate:true})
</script>
<template><section class="favorite-picker"><label class="check-option"><input v-model="enabled" type="checkbox"><span><strong>同时安装收藏模组</strong><small>按本次游戏版本检查收藏项目的兼容文件。</small></span></label><template v-if="enabled"><p v-if="busy" class="muted">逐项检查 Minecraft {{mc}} / {{loader}} 的兼容版本…</p><p v-if="error" role="alert" class="unavailable">{{error}} <button class="btn btn-ghost btn-sm" @click="retry++">重试</button></p><p v-if="!busy&&!rows.length&&!error" class="muted">暂无收藏模组。可在社区资源的「已收藏 MOD」中管理，或在浏览列表中收藏。</p><div v-for="row in rows" :key="row.favorite.key" class="favorite-row"><label><input v-model="row.checked" type="checkbox" :disabled="busy||!row.files.length" @change="update"><span>{{row.favorite.name}}</span></label><p v-if="row.error" class="unavailable" role="status">{{row.error}}</p><SelectMenu v-if="row.files.length" v-model="row.selected" :options="row.files.map(f=>({value:f.fileId,label:f.version+' · '+f.fileName}))" @change="update" /></div><p class="muted favorite-install-help">按本次游戏版本重新查询；必要前置会一并校验和安装。</p></template></section></template>
<style scoped>.favorite-picker{margin:20px 0}.favorite-row{padding:12px 0;border-bottom:1px solid var(--border)}.favorite-row label{display:flex;gap:8px;margin-bottom:8px}.unavailable{color:var(--danger,#e05260)}.favorite-picker p{font-size:13px;line-height:1.6}</style>
<style scoped>.favorite-row label{align-items:center;gap:12px}.favorite-row{padding:14px 16px;border:1px solid var(--border);border-radius:12px;margin-top:10px;background:var(--card-2)}.favorite-picker>p{margin-top:10px}.favorite-install-help{padding-top:12px;border-top:1px solid var(--border);margin-top:14px}</style>
