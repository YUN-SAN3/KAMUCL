import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store } from './store'
import { motionReduced } from '@shared/settingsCatalog'

/** Each consumer owns its listeners; no background animation survives route disposal. */
export function useMotion() {
  const query = matchMedia('(prefers-reduced-motion: reduce)')
  const system = ref(query.matches), pageHidden = ref(document.hidden), nativeHidden = ref(false)
  const hidden = computed(() => pageHidden.value || nativeHidden.value)
  let unsubscribe: (() => void) | undefined, visibilityRevision = 0, alive = true
  const update = () => { system.value = query.matches; pageHidden.value = document.hidden }
  onMounted(() => {
    query.addEventListener('change', update); document.addEventListener('visibilitychange', update)
    unsubscribe = window.kamucl.on('window:visibility', visible => { visibilityRevision++; nativeHidden.value = visible === false })
    const revision = visibilityRevision
    void window.kamucl.invoke('window:visibility').then(visible => {
      if (alive && revision === visibilityRevision) nativeHidden.value = visible === false
    }).catch(() => {})
  })
  onUnmounted(() => { alive = false; unsubscribe?.(); query.removeEventListener('change', update); document.removeEventListener('visibilitychange', update) })
  const reduced = computed(() => motionReduced(store.settings?.reduceMotion, system.value))
  return { systemReduced: system, reduced, hidden, decorativeActive: computed(() => !hidden.value && !reduced.value) }
}
