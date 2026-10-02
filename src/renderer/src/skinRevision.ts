import { ref } from 'vue'
export const skinRevision = ref(0)
export async function refreshSkinAfter<T>(request: Promise<T>): Promise<T> {
  const result = await request
  skinRevision.value++
  return result
}
