import { reactive } from 'vue'
import type { InstanceTarget } from '@shared/instanceCenter'
import { selectInstance, store, toast } from './store'
export const instanceCenter = reactive({ target: null as InstanceTarget|null, tab: 'overview' })
export async function openInstanceCenter(target:{id:string;folder?:string},tab='overview'){
 if(store.editMode)return
 try{const folder=target.folder||store.settings?.activeFolder||store.settings?.gameDir||'';await selectInstance(target.id,folder);instanceCenter.tab=tab;instanceCenter.target={id:target.id,folder}}
 catch(e){toast(String(e),'error')}
}
