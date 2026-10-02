import { createApp } from 'vue'
import App from './App.vue'
import { startIdleTrim } from './idleTrim'
import './styles.css'
import './ui-system.css'
import { installModalFocus } from './modalFocus'

document.documentElement.dataset.platform = window.kamucl.platform
createApp(App).mount('#app')

// 空闲瘦身挂在全局入口：不依赖任何视图生命周期，静默期暂停可重建缓存并触发 GC
startIdleTrim()
installModalFocus()
