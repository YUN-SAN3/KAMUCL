/**
 * MC 原版键位表（options.txt 的 key_* 项）与默认值。
 * 用于启动器的「默认按键」功能：启动时把默认键位同步进实例 options.txt。
 */

export interface KeybindDef {
  /** options.txt 键位项 id，如 key_key.forward */
  id: string
  /** 分类（UI 分组展示） */
  category: '移动' | '游戏' | '物品栏' | '视角' | '界面' | '多人游戏' | '杂项'
  /** 中文显示名 */
  label: string
  /** MC 默认绑定（key.keyboard.* / key.mouse.* / key.keyboard.unknown） */
  defaultBind: string
}

/** MC Java 版 options.txt 中的全部原版键位 */
export const VANILLA_KEYBINDS: KeybindDef[] = [
  // 移动
  { id: 'key_key.forward', category: '移动', label: '前进', defaultBind: 'key.keyboard.w' },
  { id: 'key_key.back', category: '移动', label: '后退', defaultBind: 'key.keyboard.s' },
  { id: 'key_key.left', category: '移动', label: '向左移动', defaultBind: 'key.keyboard.a' },
  { id: 'key_key.right', category: '移动', label: '向右移动', defaultBind: 'key.keyboard.d' },
  { id: 'key_key.jump', category: '移动', label: '跳跃', defaultBind: 'key.keyboard.space' },
  { id: 'key_key.sneak', category: '移动', label: '潜行', defaultBind: 'key.keyboard.left.shift' },
  { id: 'key_key.sprint', category: '移动', label: '疾跑', defaultBind: 'key.keyboard.left.control' },
  // 游戏
  { id: 'key_key.attack', category: '游戏', label: '攻击 / 破坏', defaultBind: 'key.mouse.left' },
  { id: 'key_key.use', category: '游戏', label: '使用物品 / 放置方块', defaultBind: 'key.mouse.right' },
  { id: 'key_key.pickItem', category: '游戏', label: '选取方块', defaultBind: 'key.mouse.middle' },
  // 物品栏
  { id: 'key_key.inventory', category: '物品栏', label: '打开 / 关闭物品栏', defaultBind: 'key.keyboard.e' },
  { id: 'key_key.drop', category: '物品栏', label: '丢弃所选物品', defaultBind: 'key.keyboard.q' },
  { id: 'key_key.swapOffhand', category: '物品栏', label: '与副手交换物品', defaultBind: 'key.keyboard.f' },
  { id: 'key_key.hotbar.1', category: '物品栏', label: '快捷栏 1', defaultBind: 'key.keyboard.1' },
  { id: 'key_key.hotbar.2', category: '物品栏', label: '快捷栏 2', defaultBind: 'key.keyboard.2' },
  { id: 'key_key.hotbar.3', category: '物品栏', label: '快捷栏 3', defaultBind: 'key.keyboard.3' },
  { id: 'key_key.hotbar.4', category: '物品栏', label: '快捷栏 4', defaultBind: 'key.keyboard.4' },
  { id: 'key_key.hotbar.5', category: '物品栏', label: '快捷栏 5', defaultBind: 'key.keyboard.5' },
  { id: 'key_key.hotbar.6', category: '物品栏', label: '快捷栏 6', defaultBind: 'key.keyboard.6' },
  { id: 'key_key.hotbar.7', category: '物品栏', label: '快捷栏 7', defaultBind: 'key.keyboard.7' },
  { id: 'key_key.hotbar.8', category: '物品栏', label: '快捷栏 8', defaultBind: 'key.keyboard.8' },
  { id: 'key_key.hotbar.9', category: '物品栏', label: '快捷栏 9', defaultBind: 'key.keyboard.9' },
  // 视角
  { id: 'key_key.togglePerspective', category: '视角', label: '切换视角', defaultBind: 'key.keyboard.f5' },
  { id: 'key_key.smoothCamera', category: '视角', label: '电影视角（平滑运镜）', defaultBind: 'key.keyboard.unknown' },
  { id: 'key_key.zoom', category: '视角', label: '放大（望远镜）', defaultBind: 'key.keyboard.c' },
  // 界面
  { id: 'key_key.chat', category: '界面', label: '打开聊天栏', defaultBind: 'key.keyboard.t' },
  { id: 'key_key.command', category: '界面', label: '输入命令', defaultBind: 'key.keyboard.slash' },
  { id: 'key_key.socialInteractions', category: '界面', label: '社交屏幕', defaultBind: 'key.keyboard.p' },
  { id: 'key_key.advancements', category: '界面', label: '进度', defaultBind: 'key.keyboard.l' },
  { id: 'key_key.screenshot', category: '界面', label: '截图', defaultBind: 'key.keyboard.f2' },
  { id: 'key_key.fullscreen', category: '界面', label: '全屏切换', defaultBind: 'key.keyboard.f11' },
  { id: 'key_key.narrator', category: '界面', label: '旁白切换', defaultBind: 'key.keyboard.b' },
  // 多人游戏
  { id: 'key_key.playerlist', category: '多人游戏', label: '玩家列表', defaultBind: 'key.keyboard.tab' },
  // 杂项
  { id: 'key_key.saveToolbarActivator', category: '杂项', label: '保存快捷栏（创造模式工具）', defaultBind: 'key.keyboard.unknown' },
  { id: 'key_key.loadToolbarActivator', category: '杂项', label: '加载快捷栏（创造模式工具）', defaultBind: 'key.keyboard.unknown' },
  { id: 'key_key.spectatorOutlines', category: '杂项', label: '旁观者模式玩家轮廓', defaultBind: 'key.keyboard.unknown' }
]

export const KEYBIND_CATEGORIES = ['移动', '游戏', '物品栏', '视角', '界面', '多人游戏', '杂项'] as const

/** DOM KeyboardEvent.code → MC 绑定值。无法识别的返回 null。 */
const CODE_TO_MC: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') map['Key' + letter.toUpperCase()] = 'key.keyboard.' + letter
  for (const digit of '0123456789') map['Digit' + digit] = 'key.keyboard.' + digit
  const named: Record<string, string> = {
    Space: 'key.keyboard.space', Tab: 'key.keyboard.tab', Enter: 'key.keyboard.enter',
    Escape: 'key.keyboard.escape', Backspace: 'key.keyboard.backspace', Delete: 'key.keyboard.delete',
    Insert: 'key.keyboard.insert', Home: 'key.keyboard.home', End: 'key.keyboard.end',
    PageUp: 'key.keyboard.page.up', PageDown: 'key.keyboard.page.down',
    ArrowUp: 'key.keyboard.up', ArrowDown: 'key.keyboard.down', ArrowLeft: 'key.keyboard.left', ArrowRight: 'key.keyboard.right',
    ShiftLeft: 'key.keyboard.left.shift', ShiftRight: 'key.keyboard.right.shift',
    ControlLeft: 'key.keyboard.left.control', ControlRight: 'key.keyboard.right.control',
    AltLeft: 'key.keyboard.left.alt', AltRight: 'key.keyboard.right.alt',
    MetaLeft: 'key.keyboard.left.win', MetaRight: 'key.keyboard.right.win',
    CapsLock: 'key.keyboard.caps.lock', NumLock: 'key.keyboard.num.lock',
    Minus: 'key.keyboard.minus', Equal: 'key.keyboard.equal',
    BracketLeft: 'key.keyboard.left.bracket', BracketRight: 'key.keyboard.right.bracket',
    Backslash: 'key.keyboard.backslash', Semicolon: 'key.keyboard.semicolon',
    Quote: 'key.keyboard.apostrophe', Comma: 'key.keyboard.comma', Period: 'key.keyboard.period',
    Slash: 'key.keyboard.slash', Backquote: 'key.keyboard.grave.accent',
    NumpadEnter: 'key.keyboard.keypad.enter'
  }
  Object.assign(map, named)
  for (let i = 1; i <= 12; i++) map['F' + i] = 'key.keyboard.f' + i
  for (let i = 0; i <= 9; i++) map['Numpad' + i] = 'key.keyboard.keypad.' + i
  const numpadOps: Record<string, string> = {
    NumpadMultiply: 'key.keyboard.keypad.multiply', NumpadAdd: 'key.keyboard.keypad.add',
    NumpadSubtract: 'key.keyboard.keypad.subtract', NumpadDecimal: 'key.keyboard.keypad.decimal',
    NumpadDivide: 'key.keyboard.keypad.divide', NumpadEqual: 'key.keyboard.keypad.equal'
  }
  Object.assign(map, numpadOps)
  return map
})()

const MOUSE_TO_MC: Record<number, string> = {
  0: 'key.mouse.left', 1: 'key.mouse.middle', 2: 'key.mouse.right', 3: 'key.mouse.4', 4: 'key.mouse.5'
}

export function codeToMcKey(code: string): string | null {
  return CODE_TO_MC[code] ?? null
}
export function mouseButtonToMcKey(button: number): string | null {
  return MOUSE_TO_MC[button] ?? null
}

/** MC 绑定值 → 简短显示（key.keyboard.left.shift → LShift，key.mouse.left → 鼠标左键） */
export function mcKeyLabel(bind: string): string {
  if (!bind || bind === 'key.keyboard.unknown') return '未绑定'
  if (bind.startsWith('key.mouse.')) {
    const names: Record<string, string> = {
      left: '鼠标左键', middle: '鼠标中键', right: '鼠标右键', 4: '鼠标侧键4', 5: '鼠标侧键5'
    }
    return names[bind.slice('key.mouse.'.length)] ?? bind
  }
  const key = bind.replace(/^key\.keyboard\./, '')
  const pretty: Record<string, string> = {
    space: '空格', tab: 'Tab', enter: '回车', escape: 'Esc', backspace: '退格', delete: 'Del',
    'left.shift': '左Shift', 'right.shift': '右Shift', 'left.control': '左Ctrl', 'right.control': '右Ctrl',
    'left.alt': '左Alt', 'right.alt': '右Alt', 'left.win': '左Win', 'right.win': '右Win',
    up: '↑', down: '↓', left: '←', right: '→', 'page.up': 'PageUp', 'page.down': 'PageDown',
    'caps.lock': 'CapsLock', 'num.lock': 'NumLock', 'grave.accent': '`', apostrophe: "'",
    slash: '/', backslash: '\\', minus: '-', equal: '=', comma: ',', period: '.',
    'left.bracket': '[', 'right.bracket': ']', semicolon: ';', home: 'Home', end: 'End', insert: 'Ins'
  }
  if (pretty[key]) return pretty[key]
  if (key.startsWith('keypad.')) return '小键盘 ' + key.slice(7)
  return key.length === 1 ? key.toUpperCase() : key
}

// ---------------- 其他游戏配置（options.txt 中非键位项） ----------------

export interface GameOptionDef {
  /** options.txt 的 key */
  id: string
  /** 分类（对应游戏内设置入口） */
  category: '视频设置' | '鼠标设置' | '辅助功能' | '资源包'
  label: string
  description?: string
  type: 'slider' | 'select' | 'boolean' | 'text'
  defaultValue: number | string | boolean
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: Array<{ value: string; label: string }>
}

/** 原版 options.txt 中可同步的其他配置项（参考游戏内设置的分类与入口层级） */
export const VANILLA_OPTIONS: GameOptionDef[] = [
  // 视频设置（游戏内「视频设置」页）
  { id: 'fov', category: '视频设置', label: '视场角（FOV）', type: 'slider', defaultValue: 70, min: 30, max: 110, step: 1, unit: '°' },
  { id: 'gamma', category: '视频设置', label: '亮度', type: 'slider', defaultValue: 0.5, min: 0, max: 1, step: 0.05 },
  { id: 'renderDistance', category: '视频设置', label: '渲染距离', type: 'slider', defaultValue: 12, min: 2, max: 32, step: 1, unit: '区块' },
  {
    id: 'graphics', category: '视频设置', label: '图像品质', type: 'select', defaultValue: '1',
    options: [{ value: '0', label: '流畅' }, { value: '1', label: '高品质' }, { value: '2', label: '极佳' }]
  },
  {
    id: 'maxFramerate', category: '视频设置', label: '帧率上限', type: 'select', defaultValue: '120',
    options: [
      { value: '260', label: '无限制' }, { value: '240', label: '240 fps' }, { value: '144', label: '144 fps' },
      { value: '120', label: '120 fps' }, { value: '60', label: '60 fps' }, { value: '30', label: '30 fps' }
    ]
  },
  { id: 'vsync', category: '视频设置', label: '垂直同步', type: 'boolean', defaultValue: true },
  // 鼠标设置（游戏内「选项 → 控制 → 鼠标设置」）
  { id: 'mouseSensitivity', category: '鼠标设置', label: '鼠标灵敏度', type: 'slider', defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  // 辅助功能（游戏内「辅助功能设置」中的操作方式）
  { id: 'sneakToggled', category: '辅助功能', label: '潜行：切换式（按一下保持）', type: 'boolean', defaultValue: false },
  { id: 'sprintToggled', category: '辅助功能', label: '疾跑：切换式（按一下保持）', type: 'boolean', defaultValue: false },
  { id: 'autoJump', category: '辅助功能', label: '自动跳跃', type: 'boolean', defaultValue: true },
  // 资源包（options.txt 的 resourcePacks 是 JSON 数组字符串）
  {
    id: 'resourcePacks', category: '资源包', label: '启用的资源包', type: 'text',
    description: '按加载顺序填写包名，逗号分隔（如 file/xxx.zip）；对应游戏内「资源包」页的已选列表',
    defaultValue: ''
  }
]

export const OPTION_CATEGORIES = ['视频设置', '鼠标设置', '辅助功能', '资源包'] as const
