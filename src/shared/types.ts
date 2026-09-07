/**
 * KAMUCL 前后端共享类型与 IPC 契约
 * 主进程 (src/main) 与渲染进程 (src/renderer) 都必须遵守本文件定义。
 */

// ---------------- 账号 ----------------
export type AccountType = 'offline' | 'microsoft' | 'yggdrasil'

export interface Account {
  id: string
  type: AccountType
  username: string
  uuid: string
  accessToken?: string
  /** 微软 OAuth refresh_token，用于静默续期 */
  refreshToken?: string
  /** MC accessToken 过期时间（epoch 秒） */
  expiresAt?: number
  /** 外置 Yggdrasil 账号所属提供商。 */
  providerId?: string
  providerName?: string
  apiRoot?: string
  /** 外置登录内部字段；IPC 列表会剥离凭据和用户属性。 */
  clientToken?: string
  loginIdentifier?: string
  userId?: string
  userProperties?: Array<{ name: string; value: string }>
}

/** 微软 device code 登录开始时返回给前端的展示信息 */
export interface MsDeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
}

export interface YggdrasilProviderInput {
  kind: 'text' | 'file'
  value: string
}

export interface YggdrasilProvider {
  id: string
  name: string
  apiRoot: string
  authServer: string
  accountServer: string
  sessionServer: string
  servicesUrl?: string
  skinDomains: string[]
  insecure: boolean
  metadataFetchedAt: string
}

/** 网络探测后的待确认配置；保存前不会进入提供商列表。 */
export interface YggdrasilProviderCandidate extends YggdrasilProvider {
  sourceLabel: string
  aliRedirected: boolean
}

export interface YggdrasilProfileChoice {
  id: string
  name: string
}

export interface YggdrasilRuntimeInfo {
  path: string
  version: string
  buildNumber: number
  sha256: string
}

export type YggdrasilLoginResult =
  | { status: 'complete'; account: Account }
  | {
      status: 'select-profile'
      challengeId: string
      providerName: string
      profiles: YggdrasilProfileChoice[]
      expiresAt: number
    }

// ---------------- 版本 ----------------
export interface RemoteVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  releaseTime: string
}

// ---------------- 游戏文件夹 ----------------
export interface GameFolder {
  /** 绝对路径 */
  path: string
  /** 显示名（默认取目录名） */
  name: string
  /** 是否为默认文件夹（承接新安装版本；libraries/assets/runtimes 共享位置） */
  isDefault: boolean
}

export interface FolderScanResult {
  folder: GameFolder
  structure: 'minecraft' | 'kamucl' | 'empty' | 'missing'
  status: 'ready' | 'warning' | 'error'
  versions: InstalledVersion[]
  errors: string[]
  scannedAt: string
  durationMs: number
}

export interface InstalledVersion {
  id: string
  /** 基于的原版版本（加载器版本等于对应 mc 版本） */
  mcVersion: string
  loader?: 'forge' | 'fabric' | 'quilt' | 'neoforge'
  loaderVersion?: string
  /** 整合包实例：来源整合包名称/版本（非整合包安装时为空） */
  modpackName?: string
  modpackVersion?: string
  /** 版本隔离：独立的 mods/存档/配置目录（versions/<id>/ 作为游戏目录） */
  isolated?: boolean
  /** 实际游戏目录；由启动与 UI 共用的解析器计算。 */
  gameDirectory?: string
  isolationReason?: 'explicit' | 'configured-path' | 'modpack' | 'detected-content' | 'shared'
  /** 下载未完成的残缺版本（json 在但客户端 jar 缺失/有 .part 残留），不算正常已安装 */
  incomplete?: boolean
  /** 安装事务失败的标记（.installing 存在），提供清理残留入口 */
  failed?: boolean
  /** 版本独立指定的 Java 路径（空 = 自动匹配） */
  javaPath?: string
  /** 当前实例显式自动匹配，优先于全局手动设置。 */
  javaAuto?: boolean
  /** 实例窗口设置覆盖；未设置时跟随全局设置。 */
  resolution?: GameResolution
  /** 实例图标：'mob:<内置生物头像id>' | 'file:<自定义图标文件名>'（空 = 默认图标） */
  icon?: string
  /** 首页启动卡专属缩略图；主进程只返回已验证的 KAMUCL 受管文件路径。 */
  thumbnail?: string
  /** 专属缩略图显示方式。 */
  thumbnailFit?: ImageFit
  /** 该版本所属的游戏文件夹路径 */
  folder: string
}

export interface IsolationMigrationPlan {
  versionId: string
  source: string
  destination: string
  items: Array<{
    name: string
    kind: 'file' | 'directory'
    files: number
    bytes: number
  }>
  conflicts: string[]
  totalFiles: number
  totalBytes: number
}

export type LoaderName = 'forge' | 'fabric' | 'quilt' | 'neoforge'

export interface InstallOptions {
  loader?: LoaderName
  loaderVersion?: string
  /** Fabric 专用：同时安装的 Fabric API 版本号（不传 = 不装） */
  fabricApi?: string
  /** 自定义实例名（作为 versions/<名> 目录名与版本 id）；不填按规则自动生成 */
  instanceName?: string
}

/** Fabric API 版本条目（来自 Modrinth） */
export interface FabricApiVersion {
  version: string
  date: string
}

// ---------------- Java ----------------
export interface JavaInfo {
  path: string
  /** 主版本号，如 8 / 17 / 21 */
  major: number
  version: string
  is64Bit: boolean
  /** Java 进程实际报告的架构，如 x64 / x86 / arm64。 */
  architecture?: string
  /** java.vendor / java.vm.vendor，无法读取时省略。 */
  vendor?: string
  /** 来源：自动扫描 / 手动添加 */
  source?: 'auto' | 'manual'
  /** 自动发现入口，例如注册表、PATH、KAMUCL Runtime、本地磁盘。 */
  sourceDetail?: string
}

// ---------------- 设置 ----------------
export type ThemeName =
  | 'blue-white'
  | 'black-orange'
  | 'white-pink'
  | 'black-pink'
  | 'custom'
  | 'transparent'

export type BuiltinThemeName = Exclude<ThemeName, 'custom'>

export type GameWindowMode = 'windowed' | 'maximized' | 'fullscreen'

export interface GameResolution {
  width: number
  height: number
  mode: GameWindowMode
  /** 兼容 0.6.x 旧配置；保存时始终与 mode 同步。 */
  fullscreen: boolean
}

/** 自定义主题：颜色实时生效；layout 字段仅用于兼容旧主题码与旧配置。 */
export interface CustomTheme {
  colors: {
    accent: string // 主色调（按钮/选中/链接）
    bg: string // 界面背景
    card: string // 卡片背景
    text: string // 主要文字
    textDim: string // 次要文字
    border: string // 边框
    sidebarBg: string // 侧栏背景
    sidebarText: string // 侧栏文字
    bannerText: string // Banner 上的文字
  }
  layout: {
    sidebarWidth: number // 侧栏宽度 px（200-300）
    bannerHeight: number // 首页 Banner 高度 px（220-420）
    radius: number // 全局圆角 px（0-24）
  }
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  colors: {
    accent: '#2563eb',
    bg: '#edf0f7',
    card: '#ffffff',
    text: '#1b2437',
    textDim: '#68718a',
    border: '#e1e6f0',
    sidebarBg: '#f5f7fb',
    sidebarText: '#1b2437',
    bannerText: '#ffffff'
  },
  layout: {
    sidebarWidth: 208,
    bannerHeight: 430,
    radius: 14
  }
}

/** 正式主题色板。所有主题共用同一套布局和玻璃材质，只改变配色与背景策略。 */
export const THEME_PRESETS: Record<
  BuiltinThemeName,
  { label: string; colors: CustomTheme['colors']; description: string }
> = {
  'blue-white': {
    label: '白蓝',
    description: '清爽明亮的蓝白玻璃界面',
    colors: {
      accent: '#2563eb',
      bg: '#edf0f7',
      card: '#ffffff',
      text: '#1b2437',
      textDim: '#68718a',
      border: '#d8dfec',
      sidebarBg: '#f5f7fb',
      sidebarText: '#536078',
      bannerText: '#ffffff'
    }
  },
  'black-orange': {
    label: '橙黑',
    description: '深色底与克制的暖橙强调色',
    colors: {
      accent: '#f97316',
      bg: '#0b0b0e',
      card: '#18181f',
      text: '#f4f2ee',
      textDim: '#aaa69f',
      border: '#35353f',
      sidebarBg: '#111116',
      sidebarText: '#aaa69f',
      bannerText: '#ffffff'
    }
  },
  'white-pink': {
    label: '粉白',
    description: '柔和浅色底与粉色强调色',
    colors: {
      accent: '#ec4899',
      bg: '#fdf2f8',
      card: '#ffffff',
      text: '#4a1d35',
      textDim: '#a06b8a',
      border: '#fbcfe8',
      sidebarBg: '#fce7f3',
      sidebarText: '#4a1d35',
      bannerText: '#ffffff'
    }
  },
  'black-pink': {
    label: '粉黑',
    description: '深色底与柔亮粉色强调色',
    colors: {
      accent: '#f472b6',
      bg: '#171019',
      card: '#211623',
      text: '#f5e8f2',
      textDim: '#a68ba3',
      border: '#3d2740',
      sidebarBg: '#1c1220',
      sidebarText: '#a68ba3',
      bannerText: '#ffffff'
    }
  },
  transparent: {
    label: '默认 · 透明',
    description: '蒂芙尼蓝重点色的系统桌面磨砂玻璃',
    colors: {
      accent: '#81d8d0',
      bg: '#10191b',
      card: '#172225',
      text: '#f4f8f5',
      textDim: '#abb8b0',
      border: '#52615a',
      sidebarBg: '#10191d',
      sidebarText: '#c2ccc5',
      bannerText: '#ffffff'
    }
  }
}

/** 兼容 0.6.x 与早期预设 key，未知值安全回退到图一默认主题。 */
export function normalizeThemeName(value: unknown): ThemeName {
  const aliases: Record<string, ThemeName> = {
    light: 'blue-white',
    dark: 'black-orange',
    'pink-white': 'white-pink',
    'pink-black': 'black-pink',
    personalized: 'custom'
  }
  const raw = typeof value === 'string' ? value : ''
  if (raw in aliases) return aliases[raw]
  if (
    raw === 'blue-white' ||
    raw === 'black-orange' ||
    raw === 'white-pink' ||
    raw === 'black-pink' ||
    raw === 'custom' ||
    raw === 'transparent'
  ) {
    return raw
  }
  return 'transparent'
}

export interface Settings {
  gameDir: string
  /** 游戏文件夹登记列表（每个文件夹独立 versions/；libraries/assets/runtimes 共享于默认文件夹） */
  folders: GameFolder[]
  /** 当前活动文件夹（新安装版本与常规寻址目标） */
  activeFolder: string
  /** 指定 java 可执行文件路径；空字符串 = 自动 */
  javaPath: string
  /** Java 自动管理：自动检测版本所需 Java，缺失时自动下载（默认开启） */
  javaAuto: boolean
  /** 手动添加的 Java 路径（展示来源标注「手动」） */
  javaCustom: string[]
  /** 从扫描结果中隐藏的 Java 路径 */
  javaHidden: string[]
  memoryMB: number
  jvmArgs: string
  resolution: GameResolution
  mirror: 'official' | 'bmclapi'
  /** 跨所有任务的 HTTP 并发上限。 */
  downloadThreads: number
  /** 合计限速（KiB/s），0 = 不限速。 */
  downloadSpeedKBps: number
  /** 新版本安装后默认开启版本隔离（独立游戏目录），可在设置中关闭 */
  defaultIsolation: boolean
  /** 微软登录用的 Azure 应用 client_id（device code flow） */
  msClientId: string
  theme: ThemeName
  /** theme === 'custom' 时使用的自定义配色与布局 */
  custom: CustomTheme
  /** 禁用的功能模块 key（mods/packs/shaders/servers/skins/community），关闭后侧栏入口隐藏 */
  disabledFeatures: string[]
  /** 收藏的版本 id 列表（各列表置顶） */
  favoriteVersions: string[]
  /** 首页布局：模块顺序与显隐（main=主列，side=右栏，数组顺序即渲染顺序） */
  homeLayout: HomeLayout
  /** 背景自定义 */
  background: BackgroundSettings
  /** 首页启动卡的全局默认缩略图（实例专属缩略图优先）。 */
  launchThumbnail: LaunchThumbnailSettings
  closeAfterLaunch: boolean
  /** 默认按键同步：开启后启动任何版本时把启动器默认键位写入该实例 options.txt 的 key_* 项 */
  keySync?: boolean
  /** 其他游戏配置同步：FOV/灵敏度/亮度/视频设置/潜行疾跑方式/资源包（独立开关，与按键同步分开） */
  optionsSync?: boolean
  /** 正版登录使用系统代理：默认直连（安全优先）；直连微软端点失败时用户可开启（CONNECT 隧道+端到端 TLS 校验保持） */
  msUseProxy?: boolean
}

// ---------------- 首页布局 ----------------
export interface HomeModule {
  key: string
  visible: boolean
}

export interface HomeLayout {
  /** 主列模块（欢迎横幅/启动日志/最近游戏） */
  main: HomeModule[]
  /** 右栏模块（账户信息/系统信息/快速操作/作者卡片） */
  side: HomeModule[]
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  main: [
    { key: 'banner', visible: true },
    { key: 'logDrawer', visible: true },
    { key: 'recentGames', visible: true }
  ],
  side: [
    { key: 'accountCard', visible: true },
    { key: 'sysInfo', visible: true },
    { key: 'quickActions', visible: true },
    { key: 'authorCard', visible: true }
  ]
}

export const HOME_MODULE_LABELS: Record<string, string> = {
  banner: '欢迎横幅',
  logDrawer: '启动日志',
  recentGames: '最近游戏',
  accountCard: '账户信息',
  sysInfo: '系统信息',
  quickActions: '快速操作',
  authorCard: '作者卡片'
}

// ---------------- 背景 ----------------
export interface BackgroundSettings {
  /** none=默认透明/颜色 / color=纯色 / image=自定义图片 */
  mode: 'none' | 'color' | 'image'
  color: string
  /** 图片路径（userData 内复制的文件名） */
  image: string
  /** 多张背景图（自动切换用；为空时回退单张 image） */
  images?: string[]
  /** 切换策略：off=固定第一张 / order=按顺序 / random=随机；每次启动自动切换一张 */
  switchMode?: 'off' | 'order' | 'random'
  /** 运行中自动切换间隔秒数（默认 300） */
  switchIntervalSec?: number
  /** 0-1 背景不透明度 */
  opacity: number
  /** 0-40 模糊度 px */
  blur: number
  /** fill=拉伸填充 / fit=完整适应 / crop=等比裁切 */
  fit: ImageFit
}

export type ImageFit = 'fill' | 'fit' | 'crop'

export interface LaunchThumbnailSettings {
  /** KAMUCL userData 受管资源路径；空字符串使用内置轮播。 */
  image: string
  /** Ordered managed carousel images; absent means migrate legacy `image`. */
  images?: string[]
  /** Default/per-image dwell time, in seconds (1..120). */
  intervalSeconds?: number
  durations?: Record<string, number>
  fit: ImageFit
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  mode: 'none',
  color: '#1b2437',
  image: '',
  opacity: 0.5,
  blur: 0,
  fit: 'crop'
}

export const DEFAULT_LAUNCH_THUMBNAIL: LaunchThumbnailSettings = {
  image: '',
  fit: 'crop'
}

// ---------------- 皮肤/披风 ----------------
export type SkinVariant = 'classic' | 'slim'

export interface SkinInfo {
  variant: SkinVariant
  url: string
  state?: string
  /** 主进程下载纹理转的 dataURL（前端渲染更稳，不受 CORS 影响） */
  dataUrl?: string
}

export interface CapeInfo {
  id: string
  alias: string
  active: boolean
  url?: string
  /** 披风纹理 dataURL */
  dataUrl?: string
}

/** 当前微软账号的皮肤档案 */
export interface ProfileSkins {
  username: string
  skins: SkinInfo[]
  capes: CapeInfo[]
}

export interface SkinHistoryItem {
  id: string
  variant: SkinVariant
  time: number
  /** 显示名（默认上传时的源文件名，可重命名） */
  name?: string
  /** 内容哈希：重复上传同一皮肤只保留一条记录 */
  hash?: string
}

export interface SkinHistoryEntry extends SkinHistoryItem {
  dataUrl: string
}
export interface ProgressEvent {
  /** 当前阶段，如 'version-json' | 'client' | 'libraries' | 'assets' | 'java' | 'loader' */
  stage: string
  /** 0-1 */
  progress: number
  /** 跨阶段的任务总进度；由主进程稳定模型计算，存在时优先于 progress。 */
  overall?: number
  /** 人类可读描述 */
  text: string
  /** 字节/秒，可空 */
  speed?: number
  /** 平滑后的剩余秒数；未知、暂停或速度不足时省略。 */
  etaSeconds?: number
  /** 下载字节统计；总量未知时 bytesTotal 省略并设置 indeterminate。 */
  bytesDone?: number
  bytesTotal?: number
  indeterminate?: boolean
  /** 当前下载源（BMCLAPI 镜像 / 官方源） */
  source?: string
  /** 所属后台任务 id（下载中心按任务聚合；无 = 全局进度条） */
  taskId?: string
  /** 任务展示名（随首条进度事件下发） */
  taskTitle?: string
}

export interface LaunchState {
  status: 'launching' | 'running' | 'exited' | 'error'
  text: string
  code?: number
  intentionalRestart?: boolean
  intentionalStop?: boolean
}

// ---------------- IPC 通道（invoke: 前端 await 调用） ----------------
export const IPC = {
  // 设置
  settingsGet: 'settings:get',
  settingsSet: 'settings:set', // (patch: Partial<Settings>) => Settings
  appSystemInfo: 'app:systemInfo', // () => SystemInfo  真实物理内存等系统信息
  appSelectDir: 'app:selectDir', // () => string | null
  appSelectFile: 'app:selectFile', // () => string | null  选择整合包文件（.mrpack/.zip）
  // 插件系统（userData/plugins/<id>/{plugin.json,main.js}，JS 插件在页面上下文执行）
  pluginsList: 'plugins:list', // () => PluginInfo[]
  pluginsInstall: 'plugins:install', // () => PluginInfo[]  弹框选择 .js/文件夹后安装
  pluginsSetEnabled: 'plugins:setEnabled', // (id: string, enabled: boolean) => PluginInfo[]
  pluginsRemove: 'plugins:remove', // (id: string) => PluginInfo[]
  pluginsReadCode: 'plugins:readCode', // (id: string) => string  仅启用插件可读
  pluginsOpenDir: 'plugins:openDir', // () => void  打开插件目录
  appSelectImage: 'app:selectImage', // () => string | null  选择图片文件（png/jpg/webp）
  appearanceImportBackground: 'appearance:importBackground', // () => Settings | null  导入受管背景并保存
  appearanceImportBackgroundMulti: 'appearance:importBackgroundMulti', // () => Settings | null  多选导入背景图（自动切换用）
  appearanceResetBackground: 'appearance:resetBackground', // () => Settings  恢复默认并清理旧受管背景
  appearanceImportLaunchThumbnail: 'appearance:importLaunchThumbnail', // () => Settings | null
  appearanceResetLaunchThumbnail: 'appearance:resetLaunchThumbnail', // () => Settings

  // 账号
  accountsList: 'accounts:list', // () => Account[]
  accountsAddOffline: 'accounts:addOffline', // (username: string) => Account
  accountsRemove: 'accounts:remove', // (id: string) => Account[]
  accountsSelect: 'accounts:select', // (id: string) => Account | null
  accountsSelected: 'accounts:selected', // () => Account | null
  accountsMsBegin: 'accounts:msBegin', // () => MsDeviceCodeInfo  开始 device code 流程
  accountsMsCancel: 'accounts:msCancel', // () => void
  accountsYggProviders: 'accounts:yggProviders', // () => YggdrasilProvider[]
  accountsYggProbe: 'accounts:yggProbe', // (YggdrasilProviderInput, allowInsecure?) => YggdrasilProviderCandidate
  accountsYggSaveProvider: 'accounts:yggSaveProvider', // (candidate, allowInsecure) => YggdrasilProvider[]
  accountsYggRemoveProvider: 'accounts:yggRemoveProvider', // (id) => YggdrasilProvider[]
  accountsYggLogin: 'accounts:yggLogin', // (providerId, identifier, password) => YggdrasilLoginResult
  accountsYggSelectProfile: 'accounts:yggSelectProfile', // (challengeId, profileId) => Account
  accountsYggRuntime: 'accounts:yggRuntime', // () => YggdrasilRuntimeInfo  下载/校验 authlib-injector
  accountsRefresh: 'accounts:refresh', // (id) => Account

  // 版本
  versionsManifest: 'versions:manifest', // (refresh?: boolean) => RemoteVersion[]
  versionsInstalled: 'versions:installed', // () => InstalledVersion[]
  versionsInstall: 'versions:install', // (versionId: string, opts?: InstallOptions) => void
  versionsRemove: 'versions:remove', // (versionId: string) => void
  versionsRename: 'versions:rename', // (id: string, newName: string) => void  重命名实例（目录+json id 同步改）
  versionsCleanup: 'versions:cleanup', // (id: string) => boolean  清理安装失败残留目录

  // 游戏文件夹管理
  foldersList: 'folders:list', // () => { folders: GameFolder[]; active: string }
  foldersAdd: 'folders:add', // (path: string) => { folders, folder, structure }，解析真实路径并去重
  foldersRemove: 'folders:remove', // (path: string) => GameFolder[]，只解除登记、绝不删除磁盘文件
  foldersRename: 'folders:rename', // (path: string, displayName: string) => GameFolder[]
  foldersSetDefault: 'folders:setDefault', // (path: string) => GameFolder[]
  foldersSetActive: 'folders:setActive', // (path: string) => void  切换活动文件夹（gameDir 跟随）
  foldersScan: 'folders:scan', // (path: string) => FolderScanResult
  foldersOpen: 'folders:open', // (path: string) => void
  foldersContextMenu: 'folders:contextMenu',
  directOverview: 'direct:overview',
  directHost: 'direct:host',
  directStop: 'direct:stop',
  directState: 'direct:state',
  directResolve: 'direct:resolve',
  directPrepareJoin: 'direct:prepareJoin',

  // 联机 · VoxLink（Go 引擎源码级移植，主进程内运行）
  voxlinkStart: 'voxlink:start', // ({mode:'host'|'join', code?, roomName?, isPublic?}) => VoxLinkState
  voxlinkStop: 'voxlink:stop', // () => VoxLinkState
  voxlinkStatus: 'voxlink:status', // () => VoxLinkState
  voxlinkLobby: 'voxlink:lobby', // () => VoxLinkRoom[]
  voxlinkSettings: 'voxlink:settings', // (partial) => VoxLinkSettings
  voxlinkEvent: 'voxlink:event', // push: {type, data}

  // 联机 · 陶瓦联机（Terracotta 官方工具驱动）
  tcStart: 'tc:start', // ({mode:'host'|'join', code?, port?}) => TerracottaState
  tcStop: 'tc:stop', // () => TerracottaState
  tcStatus: 'tc:status', // () => TerracottaState
  tcEvent: 'tc:event', // push: {type:'log'|'ready'|'error'|'stopped', data}

  // 联机 · FRP（樱花穿透）
  frpStart: 'frp:start', // ({accessKey, tunnelId, localPort?}) => FrpState
  frpStop: 'frp:stop', // () => FrpState
  frpStatus: 'frp:status', // () => FrpState
  frpEvent: 'frp:event', // push: {type:'log'|'ready'|'error'|'stopped', data}

  versionsSetJava: 'versions:setJava', // (id: string, javaPath: string) => void  版本独立指定 Java（空串恢复自动匹配）
  versionsSetResolution: 'versions:setResolution', // (id: string, resolution: GameResolution | null) => void  null = 跟随全局
  versionsSetIsolation: 'versions:setIsolation', // (versionId: string, isolated: boolean) => void  版本隔离开关；开启时把共享目录的存档/mods/配置等复制进版本独立目录（已存在项不覆盖）
  versionsIsolationPlan: 'versions:isolationPlan', // (versionId: string) => IsolationMigrationPlan

  versionsSetIcon: 'versions:setIcon', // (versionId: string, icon: string) => void  设置实例图标（'mob:<id>' / 'file:<文件名>' / '' 恢复默认）
  versionsUploadIcon: 'versions:uploadIcon', // (versionId: string) => string | null  弹窗选择图片并落地为自定义图标，返回新 icon 值（取消 = null）
  versionsUploadThumbnail: 'versions:uploadThumbnail', // (versionId: string) => string | null  导入实例专属首页缩略图
  versionsSetThumbnailFit: 'versions:setThumbnailFit', // (versionId: string, fit: ImageFit) => void
  versionsResetThumbnail: 'versions:resetThumbnail', // (versionId: string) => void
  loadersList: 'loaders:list', // (loader: LoaderName, mcVersion: string) => string[]
  fabricApiList: 'loaders:fabricApi', // (mcVersion: string) => FabricApiVersion[]

  // Java
  javaList: 'java:list', // () => JavaInfo[]（5 分钟缓存）
  javaRefresh: 'java:refresh', // (refresh?: boolean) => JavaInfo[]  后台全盘扫描；false 时可复用持久缓存
  javaAddCustom: 'java:addCustom', // (path: string) => void  手动添加（校验 java -version）
  javaPickAdd: 'java:pickAdd', // () => JavaInfo[] | null  文件选择器选 java.exe 并校验入库（取消 = null）
  javaHide: 'java:hide', // (path: string) => void  从列表隐藏
  javaCancelScan: 'java:cancelScan', // () => Promise<boolean>  等待全盘扫描后台任务确认退出

  // 游戏
  gameLaunch: 'game:launch', // (versionId: string, serverAddress?: string) => void  带 serverAddress 时用 --quickPlayMultiplayer 直接进服
  launchExportLogs: 'launch:exportLogs', // (versionId: string) => string | null  弹保存对话框导出启动失败日志包（取消 = null）
  gameKill: 'game:kill', // () => void
  gameRestart: 'game:restart',
  gameRestartCancel: 'game:restartCancel',

  // 游戏目录迁移
  gameDirMigrate: 'gameDir:migrate', // (newDir: string, migrate: boolean) => void  异步：进度走 event:progress（stage=migrate），结束走 event:gameDirDone

  // 服务器（SLP 协议 ping）
  serversList: 'servers:list', // () => ServerEntry[]
  serversAdd: 'servers:add', // (name: string, address: string) => ServerEntry[]
  serversEdit: 'servers:edit', // (id: string, name: string, address: string) => ServerEntry[]
  serversRemove: 'servers:remove', // (id: string) => ServerEntry[]
  serversPing: 'servers:ping', // (address: string) => ServerPingResult  6 秒超时
  serversBind: 'servers:bind', // (id: string, versionId: string, folder?: string) => ServerEntry[]  绑定/解绑具体实例
  serversSyncFromDat: 'servers:syncFromDat', // (versionId?: string, folder?: string) => ServerSyncResult
  serversPrepareLaunch: 'servers:prepareLaunch', // (id: string, versionId?: string, folder?: string) => ServerLaunchPreparation

  // MOD 拖入即装
  modsTargets: 'mods:targets', // Scan all registered folders; folder + id identify each target.
  modsParse: 'mods:parse', // (paths: string[]) => ModInfo[]  支持文件/文件夹路径，静默解析元数据
  modsPrepare: 'mods:prepare',
  modsCommit: 'mods:commit',
  modsDiscard: 'mods:discard',
  modsInstall: 'mods:install', // (files: string[], targetVersionId: string) => ModInstallResult[]  装入目标版本 mods 目录（遵循版本隔离）
  modsDuplicates: 'mods:duplicates', // (versionId: string) => ModDuplicateGroup[]  单版本查重
  modsCrossDuplicates: 'mods:crossDuplicates', // (versionIds: string[]) => ModCrossDuplicate[]  跨版本查重
  modsCheckUpdates: 'mods:checkUpdates', // (versionId: string) => ModUpdateReport  按 sha1 反查 Modrinth 可更新项
  modsApplyUpdates: 'mods:applyUpdates', // (versionId: string, items: ModUpdateTarget[]) => { fileName, ok, error? }[]
  // 默认按键（启动时同步进实例 options.txt）
  keysGetDefault: 'keys:getDefault', // () => Record<string, string>
  keysSetDefault: 'keys:setDefault', // (id: string, bind: string) => Record<string, string>
  keysReset: 'keys:reset', // () => Record<string, string>  全部恢复 MC 原版默认
  // 其他游戏配置默认值（FOV/灵敏度/亮度/视频/潜行疾跑/资源包）
  optionsGetDefault: 'options:getDefault', // () => Record<string, string>
  optionsSetDefault: 'options:setDefault', // (id: string, value: string) => Record<string, string>
  optionsReset: 'options:reset', // () => Record<string, string>
  optionsImportPacks: 'options:importPacks', // (paths: string[]) => Record<string, string>  拖入材质包装载
  optionsRemovePack: 'options:removePack', // (name: string) => Record<string, string>
  // 桥接 MOD 实时配置面板（游戏目录 .kamucl-bridge.json 发现 + token 校验，仅本机）
  bridgeStatus: 'bridge:status', // (versionId: string) => BridgeStatus
  bridgeManifest: 'bridge:manifest', // (versionId: string) => { protocol, params: BridgeParam[] }
  bridgeSet: 'bridge:set', // (versionId: string, id: string, value: unknown) => { ok, value?, notice?, error? }
  bridgeReset: 'bridge:reset', // (versionId: string, id?: string) => { ok, error? }
  bridgeInstall: 'bridge:install', // (versionId: string) => { ok, already?, error? }  内置桥接 MOD 装入实例 mods
  bridgeInstalled: 'bridge:installed', // (versionId: string) => boolean

  // 整合包
  modpackProbe: 'modpack:probe', // (filePath: string) => ModpackInfo  只解析不安装（供导入确认弹窗）
  modpackInstall: 'modpack:install', // (filePath: string, opts?: { nameSource?: 'file' | 'inner' }) => void  nameSource 默认 'file'（以压缩包文件名命名实例）；异步：进度走 event:progress，完成走 event:installDone（versionId = 实例 id）

  // 世界存档拖拽导入
  worldProbe: 'world:probe', // (path: string) => WorldImportInfo | null
  worldImport: 'world:import', // (path: string, options: WorldImportOptions) => WorldImportResult

  // 社区资源
  communitySearch: 'community:search', // (q: CommunityQuery) => CommunityResult[]
  communityFiles: 'community:files', // (source: 'modrinth'|'curseforge', projectId: string) => CommunityFile[]
  communityDownload: 'community:download', // (file: CommunityFile, target: { versionId: string; kind: CommunityKind }) => string  同步下载完成返回保存路径；kind=modpack 时下载后自动进入整合包安装流程

  tasksCancel: 'tasks:cancel', // (taskId: string) => Promise<boolean>  底层退出并清理完成后才返回
  tasksPause: 'tasks:pause', // (taskId: string) => boolean
  tasksResume: 'tasks:resume', // (taskId: string) => boolean

  // 皮肤/披风（均需当前选中账号为微软正版账号）
  skinProfile: 'skin:profile', // () => ProfileSkins  拉取当前账号皮肤/披风档案
  skinUpload: 'skin:upload', // (filePath: string, variant: SkinVariant) => ProfileSkins  上传并返回最新档案
  skinCape: 'skin:cape', // (capeId: string | null) => ProfileSkins  激活/卸下披风
  skinHistory: 'skin:history', // () => SkinHistoryEntry[]  历史皮肤（含 dataUrl 缩略）
  skinHistoryDelete: 'skin:historyDelete', // (id: string) => SkinHistoryEntry[]
  skinHistoryRename: 'skin:historyRename', // (id: string, name: string) => SkinHistoryEntry[]  重命名显示名
  skinUploadHistory: 'skin:uploadHistory', // (id: string) => ProfileSkins  用历史记录快速换回
  skinAvatar: 'skin:avatar', // (accountId?) => string | null  账户缓存中的完整皮肤 dataURL，renderer 统一裁剪头部

  // 文件/目录（rel 为相对游戏目录的子目录：'mods' | 'resourcepacks' | 'shaderpacks' | ''）
  appOpenDir: 'app:openDir', // (rel?: string) => void  用系统资源管理器打开目录
  fsList: 'fs:list', // (rel: string) => FsEntry[]
  fsRemove: 'fs:remove' // (rel: string, name: string) => FsEntry[]
} as const

export interface FsEntry {
  name: string
  size: number
  isDir: boolean
  mtime: number
}

// ---------------- IPC 事件（主进程 -> 前端，on 订阅） ----------------
export const IPC_EVENT = {
  progress: 'event:progress', // (e: ProgressEvent)
  launchLog: 'event:launchLog', // (line: string)
  launchState: 'event:launchState', // (s: LaunchState)
  msLoginDone: 'event:msLoginDone', // (account: Account | null)  null = 失败/取消
  installDone: 'event:installDone', // (r: { versionId: string; installedId?: string; ok: boolean; error?: string; taskId?: string; cancelled?: boolean; stage?: string })  installedId = 实际实例 id（含加载器后缀，成功时存在）；stage = 失败阶段；cancelled = 用户取消
  taskDone: 'event:taskDone', // (r: { taskId: string; ok: boolean; error?: string; cancelled?: boolean; stage?: string })  所有后台任务（含普通资源下载）的统一完成通知
  gameDirDone: 'event:gameDirDone' // (r: { ok: boolean; error?: string; gameDir?: string })  目录迁移结束（配置已切换/失败已回滚）
} as const

/**
 * 默认微软登录 client_id：Prism Launcher 注册的公开 Azure 应用，
 * 已在 consumers 租户实测支持 device code 流程；可在设置中替换为自注册应用
 */
export const DEFAULT_MS_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'

// ---------------- 社区资源 ----------------
export type CommunityKind = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack'
export type CommunitySource = 'modrinth' | 'curseforge'

export interface CommunityQuery {
  keyword: string
  kind: CommunityKind
  source: 'all' | CommunitySource
  mcVersion?: string
  loader?: LoaderName | ''
  /** 排序：相关度（默认）/ 最多下载 / 最新发布 */
  sort?: 'relevance' | 'downloads' | 'newest'
  /** 分页偏移 */
  offset: number
  limit: number
}

export interface CommunityResult {
  source: CommunitySource
  projectId: string
  slug: string
  title: string
  /** 源站原始名称，不包含启动器追加的中文译名。 */
  originalTitle?: string
  author: string
  description: string
  iconUrl: string
  downloads: number
  updatedAt: string
  categories: string[]
}

export interface CommunityFile {
  source?: CommunitySource
  projectId?: string
  dependencies?: CommunityDependency[]
  fileId: string
  fileName: string
  version: string
  url: string
  sha1?: string
  size: number
  releaseType: 'release' | 'beta' | 'alpha'
  gameVersions: string[]
  loaders: string[]
  date: string
}

export interface CommunityDependency {
  projectId?: string
  fileId?: string
  required: boolean
}

export interface ModRequirement { id: string; range: string }

export interface ModInstallPlan {
  id: string
  target: InstalledVersion
  files: Array<{ name: string; version: string; dependency: boolean; fileName: string }>
  missing: string[]
  warnings: string[]
}

/** 整合包探测信息（导入确认弹窗用） */
export interface ModpackInfo {
  format: 'mrpack' | 'curseforge' | 'fullpack'
  /** 包内声明的名称 */
  innerName: string
  /** 压缩包文件名（去扩展名） */
  fileName: string
  version: string
  mcVersion: string
  loader?: LoaderName
  loaderVersion?: string
  fileCount: number
  downloadBytes: number
  hasOverrides: boolean
  hasClientOverrides: boolean
  /** 包内 overrides 含 options.txt（作者预设键位/设置） */
  hasPresetKeys?: boolean
  existingInstances: Array<{
    id: string
    folder: string
    sameNormalizedName: boolean
    samePackVersion: boolean
  }>
}

export type ModpackConflictAction = 'rename' | 'new' | 'update' | 'overwrite'

export interface ModpackInstallRequest {
  nameSource?: 'file' | 'inner'
  instanceName?: string
  targetFolder?: string
  conflictAction?: ModpackConflictAction
  existingId?: string
  /** 更新/覆盖涉及既有实例时，必须由确认页显式置 true。 */
  confirmReplace?: boolean
  /** 导入时用启动器默认键位替换整合包 options.txt 中的 key_* 预设（默认关闭=保留作者预设） */
  keySyncOverride?: boolean
}

export type WorldVersionConfidence = 'exact' | 'approximate' | 'unknown'

export interface WorldResourcePackInfo {
  /** 相对于拖入目录或压缩包根的安全标识。 */
  id: string
  name: string
}

export interface WorldCandidateInfo {
  /** 相对于拖入目录或压缩包根的世界根；“.” 表示根目录。 */
  id: string
  worldName: string
  dataVersion?: number
  minecraftVersion?: string
  versionConfidence: WorldVersionConfidence
  gameMode?: '生存' | '创造' | '冒险' | '旁观'
  hardcore: boolean
  datapackCount: number
  resourcePacks: WorldResourcePackInfo[]
  hasWorldResourcePack: boolean
  modEvidence: string[]
  loader?: LoaderName
  loaderConfidence?: 'metadata' | 'inferred'
  fileCount: number
  totalBytes: number
}

export interface WorldImportInfo {
  sourcePath: string
  sourceType: 'folder' | 'zip'
  candidates: WorldCandidateInfo[]
  warnings: string[]
}

export interface WorldImportOptions {
  candidateId: string
  worldName: string
  targetFolder: string
  targetVersionId?: string
  newInstance?: {
    minecraftVersion: string
    instanceName: string
    loader?: LoaderName
    loaderVersion?: string
  }
  allowVersionMismatch?: boolean
}

export interface WorldImportResult {
  versionId: string
  worldName: string
  worldDirectory: string
  installedResourcePacks: string[]
  createdInstance: boolean
}

// ---------------- 服务器 ----------------
export interface ServerEntry {
  id: string
  name: string
  /** 交给 Minecraft 的规范化地址（默认端口省略）。 */
  address: string
  /** 用于去重的 host:port；IPv6 host 带方括号。 */
  normalizedAddress?: string
  host?: string
  port?: number
  /** 绑定的实例 id；folder 一起构成唯一实例引用。 */
  versionId?: string
  folder?: string
  minecraftVersion?: string
  loader?: LoaderName
  loaderVersion?: string
  /** KAMUCL 一键启动该条目的时间；servers.dat 本身不包含游玩时间。 */
  lastUsedAt?: string
  lastSeenAt?: string
  source?: 'launcher' | 'minecraft'
  /** 多个非隔离实例共用同一 servers.dat 时只能确定的候选实例。 */
  candidateVersionIds?: string[]
  /** 仅用于稳定区分不同共享目录中的未绑定记录，不在 UI 展示完整路径。 */
  sourceGameDirectory?: string
}

export interface ServerSyncResult {
  list: ServerEntry[]
  targets: InstalledVersion[]
  added: number
  updated: number
  errors: string[]
}

export interface ServerLaunchPreparation {
  serverId: string
  versionId: string
  folder: string
  address: string
  minecraftVersion: string
  loader?: LoaderName
  loaderVersion?: string
  /** false 时仅启动正确实例，由玩家在多人游戏菜单中选择服务器。 */
  directJoin: boolean
}

// ---------------- MOD 拖入即装 ----------------
/** 单个 MOD 文件的元数据解析结果 */
export interface ModInfo {
  /** jar 文件绝对路径 */
  filePath: string
  fileName: string
  /** 解析出的 mod id（失败为空） */
  id: string
  /** 展示名 */
  name: string
  /** MOD 版本号 */
  version: string
  /** 所属加载器 */
  loader: LoaderName | null
  /** 支持的 MC 版本范围原文（如 [1.20,) / 1.20.1） */
  mcRange: string
  /** 要求的加载器版本范围原文（如 >=0.15.0 / [65.0,)） */
  loaderRange?: string
  /** 前置依赖 mod id 列表 */
  dependencies: string[]
  requirements?: ModRequirement[]
  /** Multi-loader jars may contain several independent metadata descriptors. */
  variants?: Array<{ loader: LoaderName; mcRange: string; loaderRange?: string; requirements?: ModRequirement[] }>
  provides?: Array<{ id: string; version: string }>
  /** 图标 dataURL（jar 内嵌图标） */
  iconDataUrl?: string
  /** 解析失败原因（非 MOD/损坏时存在） */
  error?: string
}

export interface ModInstallResult {
  fileName: string
  ok: boolean
  message: string
}

/** 单版本重复 MOD 组（同 mod id 多文件共存） */
export interface ModDuplicateGroup {
  modId: string
  name: string
  files: Array<{ fileName: string; version: string; /** 排序后的最新版（默认保留） */ latest: boolean }>
}

/** 跨版本重复：同一 mod id 同时存在于多个版本 */
export interface ModCrossDuplicate {
  modId: string
  name: string
  /** 出现该 MOD 的版本列表（版本 id + 文件名） */
  presentIn: Array<{ versionId: string; fileName: string }>
}

/** MOD 更新检测：单个已安装 MOD 的检测结果 */
export interface ModUpdateEntry {
  fileName: string
  name: string
  modId: string
  currentVersion: string
  sha1: string
  /** null = 未在 Modrinth 匹配到来源（可能来自 CurseForge 或手动安装） */
  source: 'modrinth' | null
  alreadyLatest: boolean
  update: null | {
    projectId: string
    versionId: string
    versionNumber: string
    fileName: string
    url: string
    sha1?: string
    size?: number
  }
}

export interface ModUpdateReport {
  mcVersion: string
  loader: string
  entries: ModUpdateEntry[]
}

/** 应用更新的单项：旧文件 + 新文件下载信息 */
export interface ModUpdateTarget {
  fileName: string
  url: string
  targetName: string
  sha1?: string
  size?: number
}

/** 插件信息（plugin.json 元数据 + 启用状态） */
export interface PluginInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  hasCode: boolean
}

/** 桥接 MOD 连接状态 */
export interface BridgeStatus {
  connected: boolean
  reason?: string
  modVersion?: string
  protocol?: number
}

/** 桥接 MOD 参数定义（MOD 声明元数据，面板自动生成控件） */
export interface BridgeParam {
  id: string
  modId: string
  label: string
  description: string
  group: string
  kind: 'SWITCH' | 'SLIDER' | 'TEXT' | 'SELECT'
  apply: 'INSTANT' | 'RELOAD_RESOURCES' | 'REJOIN_WORLD' | 'RESTART_GAME'
  scope: 'CLIENT' | 'SERVER'
  defaultValue: unknown
  value: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
  visible: boolean
}

export interface ServerPingResult {
  online: boolean
  /** 在线/上限，如 "12/100" */
  players: string
  /** MOTD 纯文本（去格式化码） */
  motd: string
  version: string
  latencyMs: number
}

export interface SystemInfo {
  /** 物理内存总量（MB，向下取整） */
  totalMemMB: number
}
