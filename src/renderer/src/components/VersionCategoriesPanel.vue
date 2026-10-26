<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type { VersionCategory, VersionCategoryAction } from '@shared/types'

const props = defineProps<{ open: boolean; categories: VersionCategory[]; counts: Record<string, number>; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; action: [action: VersionCategoryAction] }>()
const panel = ref<HTMLElement | null>(null), name = ref(''), renaming = reactive({ id: '', name: '' }), deleting = ref<VersionCategory | null>(null)
let returnFocus: HTMLElement | null = null
watch(() => props.open, async open => {
  if (open) {
    returnFocus = document.activeElement as HTMLElement | null
    name.value = ''; renaming.id = ''; deleting.value = null
    await nextTick(); panel.value?.querySelector<HTMLInputElement>('input')?.focus()
  } else returnFocus?.focus()
})
function close() { if (!props.busy) emit('close') }
watch(deleting, async value => {
  await nextTick()
  if (value) panel.value?.querySelector<HTMLButtonElement>('[data-ui="games:category-delete-cancel"]')?.focus()
  else panel.value?.querySelector<HTMLInputElement>('input')?.focus()
})
function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); if (!props.busy) { if (deleting.value) deleting.value = null; else close() } return }
  if (event.key !== 'Tab') return
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')]
  if (!items.length) return
  const edge = event.shiftKey ? items[0] : items.at(-1)
  if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus() }
}
function create() { if (!props.busy && name.value.trim()) emit('action', { type: 'create', name: name.value }) }
function rename() { if (!props.busy && renaming.id && renaming.name.trim()) emit('action', { type: 'rename', id: renaming.id, name: renaming.name }) }
watch(() => props.categories, categories => {
  if (renaming.id && categories.find(c => c.id === renaming.id)?.name === renaming.name.trim()) renaming.id = ''
  if (deleting.value && !categories.some(c => c.id === deleting.value?.id)) deleting.value = null
  if (name.value.trim() && categories.some(c => c.name === name.value.trim())) name.value = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" data-ui="games:category-manager" @pointerdown.self="close">
      <section ref="panel" class="modal category-manager" :role="deleting ? 'alertdialog' : 'dialog'" aria-modal="true" aria-labelledby="version-category-title" @keydown="trapFocus">
        <header class="category-header"><h3 id="version-category-title" class="modal-title">{{ deleting ? '删除分类' : '管理版本分类' }}</h3><button class="btn btn-ghost" :disabled="busy" aria-label="关闭分类管理" @click="close">×</button></header>
        <div v-if="deleting" class="category-content"><p>删除“{{ deleting.name }}”后，其实例将回到未分类。实例文件和收藏均会保留。</p><p v-if="error" class="error" role="alert">{{ error }}</p></div>
        <div v-else class="category-content">
          <p class="muted">分类用于整理实例，不改变安装位置。“收藏”自动显示已收藏的版本。此处统计包含全部游戏文件夹。</p>
          <form class="category-create" @submit.prevent="create"><label for="version-category-name">新建分类</label><div><input id="version-category-name" v-model="name" class="input" maxlength="40" placeholder="例如：生存、整合包、测试" :disabled="busy" /><button class="btn btn-gold" :disabled="busy || !name.trim()">新建</button></div></form>
          <p v-if="!categories.length" class="category-empty muted">还没有自建分类。在版本的“更多操作”中可选择所属分类。</p>
          <ul v-else class="category-list" aria-label="自建分类">
            <li v-for="category in categories" :key="category.id">
              <form v-if="renaming.id === category.id" class="category-rename" @submit.prevent="rename"><input v-model="renaming.name" class="input" maxlength="40" :aria-label="'重命名 ' + category.name" :disabled="busy" /><button class="btn btn-gold btn-sm" :disabled="busy || !renaming.name.trim() || renaming.name.trim() === category.name">保存</button><button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="renaming.id = ''">取消</button></form>
              <template v-else><div class="category-name"><strong>{{ category.name }}</strong><span class="muted">{{ counts[category.id] || 0 }} 个实例</span></div><div class="category-actions"><button class="btn btn-ghost btn-sm" :disabled="busy" :aria-label="'重命名分类 ' + category.name" @click="renaming.id = category.id; renaming.name = category.name">重命名</button><button class="btn btn-ghost btn-sm" :disabled="busy" :aria-label="'删除分类 ' + category.name" @click="deleting = category">删除</button></div></template>
            </li>
          </ul>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
        <footer v-if="deleting" class="modal-actions category-footer"><button class="btn btn-ghost" data-ui="games:category-delete-cancel" :disabled="busy" @click="deleting = null">取消</button><button class="btn btn-danger" data-ui="games:category-delete-confirm" :disabled="busy" @click="emit('action', { type: 'remove', id: deleting.id })">{{ busy ? '删除中…' : '仅删除分类' }}</button></footer>
        <footer v-else class="modal-actions category-footer"><button class="btn btn-ghost" :disabled="busy" @click="close">完成</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.category-manager{display:flex;flex-direction:column;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;overflow:hidden}.category-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;gap:12px}.category-header .modal-title{margin:0}.category-content{overflow:auto;padding:0 24px 16px;min-height:0}.category-content>p{line-height:1.7;overflow-wrap:anywhere}.category-create>label{display:block;margin:16px 0 8px}.category-create>div,.category-rename{display:flex;gap:8px;align-items:center}.category-create input,.category-rename input{min-width:0;flex:1}.category-list{padding:0;list-style:none;margin:18px 0 0}.category-list>li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--border)}.category-name{min-width:0;display:flex;flex-direction:column;gap:6px}.category-name strong{overflow-wrap:anywhere}.category-name span{font-size:12px}.category-actions{display:flex;flex-shrink:0;gap:6px}.category-rename{width:100%;flex-wrap:wrap}.category-footer{border-top:1px solid var(--border);padding:14px 24px;margin:0}.category-empty{padding:16px 0}@media(max-width:600px){.category-header,.category-content{padding-left:16px;padding-right:16px}.category-list>li{flex-wrap:wrap}.category-rename input{flex-basis:100%}}
</style>
