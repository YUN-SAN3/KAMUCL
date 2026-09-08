import { createApp } from 'vue'
import App from './App.vue'
import { startIdleTrim } from './idleTrim'
import './styles.css'

createApp(App).mount('#app')

// 空闲瘦身挂在全局入口：不依赖任何视图生命周期，静默期暂停可重建缓存并触发 GC
startIdleTrim()
