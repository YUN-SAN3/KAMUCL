/** UI navigation only; settings storage and defaults remain owned by core/settings. */
export const settingsScopes = [
  { id: 'launcher', label: '启动器设置' }, { id: 'game', label: '游戏设置' }
] as const
export type SettingsScope = typeof settingsScopes[number]['id']
export const settingsCategories = [
  { id: 'appearance', scope: 'launcher', label: '外观' },
  { id: 'general', scope: 'launcher', label: '行为与登录' },
  { id: 'downloads', scope: 'launcher', label: '下载' },
  { id: 'features', scope: 'launcher', label: '功能与插件' },
  { id: 'about', scope: 'launcher', label: '关于与更新' },
  { id: 'game', scope: 'game', label: '运行环境' },
  { id: 'display', scope: 'game', label: '游戏窗口' },
  { id: 'directories', scope: 'game', label: '目录与隔离' }
] as const
export function scopeOfCategory(id: string): SettingsScope {
  return settingsCategories.find(c => c.id === id)?.scope ?? 'launcher'
}
export type SettingsCategory = typeof settingsCategories[number]['id']
export const settingsCatalog = [
  { id: 'theme', category: 'appearance', name: '主题与个性化', keywords: '颜色 黑紫 深色 浅色 透明 自定义 字体 外观工作台' },
  { id: 'background', category: 'appearance', name: '窗口背景', keywords: '壁纸 图片 玻璃 模糊 透明度' },
  { id: 'thumbnail', category: 'appearance', name: '首页启动卡图片', keywords: '轮播 插画 缩略图 背景 停留时间' },
  { id: 'motion', category: 'appearance', name: '减少动态效果', keywords: '动画 动效 系统偏好 晕动 静止' },
  { id: 'isolation', category: 'directories', name: '新版本默认隔离', keywords: '存档 模组 配置 独立 共享目录' },
  { id: 'memory', category: 'game', name: '内存分配', keywords: 'RAM 自动分配 GB 性能' },
  { id: 'java', category: 'game', name: 'Java 运行时', keywords: 'JDK JVM 路径 自动下载 检测 扫描 手动添加' },
  { id: 'resolution', category: 'display', name: '游戏窗口分辨率', keywords: '宽 高 最大化 全屏 窗口化' },
  { id: 'jvm', category: 'game', name: 'JVM 参数', keywords: '高级 垃圾回收 GC G1GC 启动参数' },
  { id: 'launch', category: 'general', name: '启动器行为与正版登录', keywords: '启动后关闭启动器 微软 系统代理 Microsoft 登录' },
  { id: 'installation', category: 'directories', name: '新版本安装目录', keywords: '游戏文件夹 路径 下载位置 绑定目录' },
  { id: 'downloads', category: 'downloads', name: '下载并发与速度', keywords: '最大线程数 限速 KiB CurseForge API Key 密钥 下载队列' },
  { id: 'mirror', category: 'downloads', name: '下载镜像', keywords: '官方源 BMCLAPI 网络' },
  { id: 'features', category: 'features', name: '功能管理', keywords: '侧边栏 模组 资源包 光影 录像 MOD 面板 服务器 联机 皮肤 社区' },
  { id: 'plugins', category: 'features', name: '插件', keywords: '安装 删除 启用 停用 JS' },
  { id: 'update', category: 'about', name: '关于与更新', keywords: '版本 自动更新 检查更新 下载源 镜像 回退 还原 本地更新 许可 开源' }
] as const
export function searchSettings(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return words.length ? settingsCatalog.filter(item => words.every(word => `${item.name} ${item.keywords}`.toLocaleLowerCase().includes(word))) : []
}
export function motionReduced(value: unknown, system: boolean): boolean {
  return value === true || system
}
