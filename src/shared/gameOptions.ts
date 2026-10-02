import { mcVersionAtLeast } from './keybindings'

export type GameOptionValue = number | boolean | string
export interface GameOptionDef {
  id: string; label: string; page: string; initial: GameOptionValue
  min?: number; max?: number; step?: number; unit?: string; since?: string; until?: string
  choices?: readonly (readonly [GameOptionValue, string])[]
  encoding?: 'percent' | 'sensitivity' | 'fov' | 'text' | 'json' | 'chatOpacity' | 'chatWidth' | 'chatHeight'
}
const bool = (id: string, label: string, page: string, initial = true, since?: string): GameOptionDef => ({ id, label, page, initial, since })
const percent = (id: string, label: string, page: string, initial = 100, since?: string): GameOptionDef => ({ id, label, page, initial, min: 0, max: 100, step: 1, unit: '%', encoding: 'percent', since })
const integer = (id: string, label: string, page: string, initial: number, min: number, max: number, since?: string): GameOptionDef => ({ id, label, page, initial, min, max, step: 1, since })
export const GAME_OPTION_PAGES = [
  ['skin', '皮肤自定义'], ['sounds', '音乐和声音'], ['video', '视频设置'], ['controls', '控制'],
  ['language', '语言'], ['chat', '聊天设置'], ['packs', '资源包'], ['accessibility', '辅助功能'],
  ['telemetry', '遥测数据'], ['credits', '鸣谢和著作权']
] as const
export const GAME_OPTIONS: GameOptionDef[] = [
  { ...integer('fov', '视场角', 'root', 70, 30, 110), encoding: 'fov', unit: '°' },
  { id: 'mainHand', label: '主手', page: 'skin', initial: 'right', choices: [['right', '右手'], ['left', '左手']], since: '1.9', encoding: 'text' },
  ...['cape', 'jacket', 'left_sleeve', 'right_sleeve', 'left_pants_leg', 'right_pants_leg', 'hat'].map((part, i) => bool('modelPart_' + part, ['披风', '上衣', '左袖', '右袖', '左裤腿', '右裤腿', '帽子'][i], 'skin')),
  ...['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'].map((category, i) => percent('soundCategory_' + category, ['主音量', '音乐', '唱片 / 音符盒', '天气', '方块', '敌对生物', '友好生物', '玩家', '环境', '声音 / 语音'][i], 'sounds')),
  bool('showSubtitles', '显示字幕', 'sounds', false, '1.9'),
  bool('directionalAudio', '定向音频', 'sounds', false, '1.19.4'),
  integer('renderDistance', '渲染距离', 'video', 12, 2, 32),
  integer('simulationDistance', '模拟距离', 'video', 12, 5, 32, '1.18'),
  integer('maxFps', '最大帧率', 'video', 120, 10, 260),
  bool('enableVsync', '垂直同步', 'video'),
  integer('guiScale', '界面尺寸（0 为自动）', 'video', 0, 0, 4),
  percent('gamma', '亮度', 'video', 50),
  bool('bobView', '视角摇晃', 'video'),
  { id: 'particles', label: '粒子效果', page: 'video', initial: 0, choices: [[0, '全部'], [1, '减少'], [2, '最少']] },
  { id: 'attackIndicator', label: '攻击指示器', page: 'video', initial: 1, choices: [[0, '关闭'], [1, '准星'], [2, '快捷栏']], since: '1.9' },
  bool('entityShadows', '实体阴影', 'video', true, '1.8'),
  integer('mipmapLevels', 'Mipmap 级别', 'video', 4, 0, 4),
  bool('showAutosaveIndicator', '显示自动保存指示器', 'video', true, '1.18'),
  bool('ao', '平滑光照', 'video', true, '1.20.1'),
  { id: 'renderClouds', label: '云', page: 'video', initial: 'fancy', choices: [['off', '关闭'], ['fast', '快速'], ['fancy', '精致']], encoding: 'json', since: '1.19' },
  { ...percent('entityDistanceScaling', '实体渲染距离', 'video', 100, '1.16'), min: 50, max: 500, step: 25 },
  integer('menuBackgroundBlurriness', '菜单背景模糊', 'video', 5, 0, 10, '1.20.5'),
  integer('cloudRange', '云渲染距离', 'video', 128, 2, 128, '26.2'),
  bool('cutoutLeaves', '树叶透明', 'video', true, '26.2'),
  bool('improvedTransparency', '改进透明效果', 'video', true, '26.2'),
  integer('weatherRadius', '天气半径', 'video', 10, 3, 10, '26.2'),
  bool('vignette', '暗角', 'video', true, '26.2'),
  { ...integer('chunkSectionFadeInTime', '区块淡入时间', 'video', .75, 0, 2, '26.2'), step: .05, unit: '秒' },
  { id: 'toggleCrouch', label: '潜行', page: 'controls', initial: false, choices: [[false, '按住'], [true, '切换']], since: '1.15' },
  { id: 'toggleSprint', label: '疾跑', page: 'controls', initial: false, choices: [[false, '按住'], [true, '切换']], since: '1.15' },
  { id: 'toggleAttack', label: '攻击 / 破坏', page: 'controls', initial: false, choices: [[false, '按住'], [true, '切换']], since: '26.2' },
  { id: 'toggleUse', label: '使用 / 放置', page: 'controls', initial: false, choices: [[false, '按住'], [true, '切换']], since: '26.2' },
  bool('autoJump', '自动跳跃', 'controls', false, '1.10'),
  integer('sprintWindow', '双击疾跑间隔（0 为关闭）', 'controls', 7, 0, 10, '26.2'),
  bool('operatorItemsTab', '管理员物品选项卡', 'controls', false, '1.19.3'),
  { ...integer('mouseSensitivity', '鼠标灵敏度', 'mouse', 100, 0, 200), encoding: 'sensitivity', unit: '%' },
  { ...integer('mouseWheelSensitivity', '滚动灵敏度', 'mouse', 1, .01, 10, '1.14'), step: .01 },
  bool('discrete_mouse_scroll', '离散滚动', 'mouse', false, '1.14'),
  bool('invertXMouse', '反转鼠标 X 轴', 'mouse', false, '26.2'),
  bool('invertYMouse', '反转鼠标 Y 轴', 'mouse', false),
  bool('allowCursorChanges', '允许更改鼠标指针', 'mouse', true, '26.2'),
  { ...bool('touchscreen', '触屏模式', 'mouse', false), until: '26.1' },
  bool('rawMouseInput', '原始输入', 'mouse', true, '1.14'),
  { id: 'lang', label: '语言', page: 'language', initial: 'zh_cn', encoding: 'text', choices: [['zh_cn', '简体中文'], ['zh_tw', '繁體中文（台灣）'], ['zh_hk', '繁體中文（香港）'], ['en_us', 'English (US)'], ['en_gb', 'English (UK)'], ['ja_jp', '日本語'], ['ko_kr', '한국어'], ['de_de', 'Deutsch'], ['fr_fr', 'Français'], ['es_es', 'Español'], ['ru_ru', 'Русский']] },
  bool('forceUnicodeFont', '强制使用 Unicode 字体', 'language', false),
  { id: 'chatVisibility', label: '聊天', page: 'chat', initial: 0, choices: [[0, '显示'], [1, '仅命令'], [2, '隐藏']] },
  bool('chatColors', '聊天颜色', 'chat'), bool('chatLinks', '网页链接', 'chat'),
  { ...percent('chatOpacity', '聊天不透明度', 'chat'), min: 10, encoding: 'chatOpacity' }, bool('chatLinksPrompt', '链接提示', 'chat'),
  percent('chatScale', '聊天缩放', 'chat'), { ...integer('chatWidth', '聊天宽度', 'chat', 320, 40, 320), encoding: 'chatWidth', unit: 'px' },
  { ...integer('chatHeightFocused', '聊天高度（焦点）', 'chat', 180, 20, 180), encoding: 'chatHeight', unit: 'px' },
  { ...integer('chatHeightUnfocused', '聊天高度（无焦点）', 'chat', 90, 20, 180), encoding: 'chatHeight', unit: 'px' },
  percent('textBackgroundOpacity', '文字背景不透明度', 'chat', 50, '1.14'),
  percent('chatLineSpacing', '聊天行间距', 'chat', 0, '1.16'),
  { id: 'narrator', label: '旁白', page: 'accessibility', initial: 0, choices: [[0, '关闭'], [1, '全部'], [2, '聊天'], [3, '系统']], since: '1.12' },
  bool('highContrast', '高对比度', 'accessibility', false, '1.19.4'),
  ...['toggleCrouch', 'toggleSprint', 'autoJump', 'showSubtitles'].map(id => ({ id, label: '', page: 'accessibility', initial: false })),
  percent('screenEffectScale', '失真效果', 'accessibility', 100, '1.16.2'),
  percent('fovEffectScale', '视场角效果', 'accessibility', 100, '1.16.2'),
  percent('darknessEffectScale', '黑暗效果', 'accessibility', 100, '1.19'),
  percent('glintSpeed', '附魔光效速度', 'accessibility', 50, '1.19.4'),
  percent('glintStrength', '附魔光效强度', 'accessibility', 75, '1.19.4'),
  percent('damageTiltStrength', '受伤倾斜', 'accessibility', 100, '1.19.4'),
  bool('hideLightningFlashes', '隐藏闪电闪光', 'accessibility', false, '1.19.4'),
  bool('darkMojangStudiosBackground', '深色加载画面', 'accessibility', false, '1.16'),
  percent('panoramaScrollSpeed', '全景图滚动速度', 'accessibility', 100, '1.19.4'),
  bool('highContrastBlockOutline', '高对比度方块轮廓', 'accessibility', false, '1.21.2'),
  bool('narratorHotkey', '旁白快捷键', 'accessibility', true, '1.21.2'),
  bool('telemetryOptInExtra', '发送可选遥测数据', 'telemetry', false, '1.19.3')
]
export const uniqueGameOptions = GAME_OPTIONS.filter((d, i, a) => a.findIndex(other => other.id === d.id) === i)
// Same row-major sequence as the game's video submenus: quality, display, appearance.
export const VIDEO_OPTION_ORDER = ['renderDistance', 'simulationDistance', 'ao', 'renderClouds', 'particles', 'mipmapLevels', 'entityShadows', 'entityDistanceScaling', 'menuBackgroundBlurriness', 'cloudRange', 'cutoutLeaves', 'improvedTransparency', 'weatherRadius', 'maxFps', 'enableVsync', 'guiScale', 'gamma', 'bobView', 'showAutosaveIndicator', 'vignette', 'attackIndicator', 'chunkSectionFadeInTime']
export function supportedGameOption(def: GameOptionDef, version: string): boolean {
  return (!def.since || mcVersionAtLeast(version, def.since)) && (!def.until || !mcVersionAtLeast(version, def.until))
}
export function validateGameOption(id: string, value: unknown): asserts value is GameOptionValue {
  const d = uniqueGameOptions.find(d => d.id === id)
  if (!d) throw new Error('未知游戏选项')
  if (d.choices ? !d.choices.some(c => c[0] === value) : typeof value !== typeof d.initial) throw new Error('游戏选项值无效')
  if (typeof value === 'number' && (!Number.isFinite(value) || value < d.min! || value > d.max! || (d.step === 1 && !Number.isInteger(value)))) throw new Error('游戏选项超出有效范围')
}
export function encodeGameOption(d: GameOptionDef, value: GameOptionValue, version: string): string {
  validateGameOption(d.id, value)
  if (d.encoding === 'fov') return String((Number(value) - 70) / 40)
  if (d.encoding === 'chatOpacity') return String((Number(value) - 10) / 90)
  if (d.encoding === 'chatWidth') return String((Number(value) - 40) / 280)
  if (d.encoding === 'chatHeight') return String((Number(value) - 20) / 160)
  if (d.encoding === 'percent') return String(Number(value) / 100)
  if (d.encoding === 'sensitivity') return String(Number(value) / 200)
  if (d.encoding === 'json') return JSON.stringify(value)
  if (d.id === 'lang' && !mcVersionAtLeast(version, '1.11')) return String(value).replace(/_([a-z]+)/, (_, region) => '_' + region.toUpperCase())
  if (d.id === 'mainHand' && mcVersionAtLeast(version, '1.19')) return JSON.stringify(value)
  return String(value)
}
export interface DefaultGameOptions { enabled: boolean; values: Record<string, GameOptionValue> }
