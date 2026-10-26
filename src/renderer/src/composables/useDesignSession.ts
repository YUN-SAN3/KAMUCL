import { computed, nextTick, onMounted, ref } from 'vue'
import { DEFAULT_CUSTOM_THEME, DEFAULT_HOME_LAYOUT, DEFAULT_BACKGROUND, DEFAULT_LAUNCH_THUMBNAIL } from '@shared/types'
import { copyText } from '../api'
import { store, exitEditMode, toast } from '../store'
import { finishDesign, flushDesign, designDraft, designDirty, designSaveState, designStageReady, previewAppearance } from '../visualDesign'
import { captureDesignNavigationScroll, restoreDesignNavigationScroll, type DesignNavigationScroll } from '../designNavigationScroll'
import { restoreLostControlFocus } from '../controlFocus'

/** Draft persistence, recovery and explicit apply/cancel actions. */
export function useDesignSession() {
  const exitOpen = ref(false), busy = ref(false), themeOpen = ref(false), code = ref('')
  let navigation: DesignNavigationScroll | undefined
  // This hook precedes the canvas hook that enables the launcher Teleport.
  onMounted(() => { navigation = captureDesignNavigationScroll(document.querySelector<HTMLElement>('.shell .nav')) })
  const status = computed(() => busy.value ? '正在保存…' : designDirty.value ? `${designSaveState.value || '修改已进入草稿'} · 尚未应用` : '当前已应用外观 · 修改会先进入草稿')
  async function close(action: 'apply' | 'keep' | 'discard') {
    if (busy.value) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let failed = false
    busy.value = true
    try {
      await finishDesign(action); designStageReady.value = false; exitEditMode()
      await nextTick()
      // The design runtime restores its inline styles on the next layout frame.
      // Measure after that restoration, without changing focus or navigation.
      await new Promise<void>(resolve => requestAnimationFrame(() => { restoreDesignNavigationScroll(navigation); resolve() }))
    }
    catch (error) { failed = true; toast('保存失败，草稿已保留：' + String(error), 'error') }
    finally {
      busy.value = false
      if (failed) { await nextTick(); restoreLostControlFocus(previousFocus, '.design-workspace') }
    }
  }
  function requestClose() { if (designDirty.value) exitOpen.value = true; else void close('discard') }
  async function exportTheme() {
    try { await flushDesign(); const result = await window.kamucl.invoke('appearance:exportTheme', designDraft.value); await copyText(String(result)); toast('完整主题码已复制', 'success') }
    catch (error) { toast(String(error), 'error') }
  }
  async function importTheme() {
    try { previewAppearance(await window.kamucl.invoke('appearance:importTheme', code.value, true) as any); themeOpen.value = false; code.value = ''; toast('主题已载入草稿，应用后生效', 'success') }
    catch (error) { toast(String(error), 'error') }
  }
  function restoreApplied() {
    if (store.settings) previewAppearance(store.settings)
    themeOpen.value = false
    toast('已回到当前正式外观，可继续编辑或撤销', 'info')
  }
  function defaults() {
    previewAppearance({ theme: 'transparent', custom: structuredClone(DEFAULT_CUSTOM_THEME), homeLayout: structuredClone(DEFAULT_HOME_LAYOUT), background: structuredClone(DEFAULT_BACKGROUND), launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL), visualDesign: { version: 1, pages: {} } })
    themeOpen.value = false
    toast('默认外观已进入草稿，应用后生效；可撤销', 'info')
  }
  return { exitOpen, busy, themeOpen, code, status, close, requestClose, exportTheme, importTheme, restoreApplied, defaults }
}
