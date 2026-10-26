import { computed, ref } from 'vue'
import { getSystemInfo } from '../api'
const systemInstaller = ref(false)
let requested = false
/** Keep native installer handoff distinct from a completed portable replacement. */
export function usePlatformUpdate() {
  if (!requested) {
    requested = true
    if (window.kamucl.platform === 'linux') void getSystemInfo().then(info => { systemInstaller.value = info.installation === 'deb' }).catch(() => {})
  }
  const installAction = computed(() => systemInstaller.value ? '下次启动打开安装器' : '下次启动应用')
  const installExplanation = computed(() => systemInstaller.value
    ? '安装包已下载并通过 SHA256 完整性校验。下次启动将打开系统安装器，确认并完成系统安装后才会更新。'
    : '安装包已下载并通过 SHA256 完整性校验。下次手动启动时完成安装，替换前会自动备份当前版本。')
  const updateReadyMessage = (prefix = '更新已就绪') => prefix + (systemInstaller.value
    ? '，下次启动将打开系统安装器，确认后完成安装'
    : '，下次手动启动时应用')
  return { systemInstaller, installAction, installExplanation, updateReadyMessage }
}
