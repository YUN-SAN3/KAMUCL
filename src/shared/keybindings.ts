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

export function parseSnapshotId(version: string): [number, number] | null {
  const m = /^(\d{2})w(\d{1,2})[a-e]?$/i.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

/**
 * 把任意 MC 版本字符串映射为可比较的数值元组（版本族）：
 * - 正式版按数字段比较（26.x 新版号天然大于所有 1.x）；-pre/-rc/-snapshot 及 "1.14 Pre-Release 2"
 *   等开发后缀视为其对应正式版（pre1/rc1 的 options.txt 字段已与正式版一致）；
 * - 快照按「年-周 → 版本族」映射，分界周对齐启动器判定的功能引入点：
 *   16w20a=autoJump(1.10)、17w43a=新键位系统(1.13)、19w41a=toggleCrouch/toggleSprint(1.15)、
 *   20w06a=1.16 开发周期（graphicsMode）、25w41a=1.21.11 开发周期（graphicsPreset）、26.x 新版号。
 *   只需保证对本启动器使用的分界目标（1.10/1.13/1.15/1.16/1.21.11/26.x）单调正确。
 * 无法解析的非常规 id 按最新处理（与空版本一致的保守方向：宁写新字段不写错旧字段会由字段本身被忽略兜底）。
 */
export function mcVersionFamily(version: string): number[] {
  const v = String(version ?? '').trim()
  const snap = parseSnapshotId(v)
  if (snap) {
    const [yy, ww] = snap
    if (yy >= 26) return [26, 0]
    if (yy === 25) return ww >= 41 ? [1, 21, 11] : [1, 21, 10]
    if (yy === 24) return [1, 21, 4]
    if (yy === 23) return [1, 20, 4]
    if (yy === 22) return [1, 19, 3]
    if (yy === 21) return [1, 18, 2]
    if (yy === 20) return ww >= 6 ? [1, 16, 5] : [1, 15, 2]
    if (yy === 19) return ww >= 41 ? [1, 15, 2] : [1, 14, 4]
    if (yy === 18) return [1, 14, 4]
    if (yy === 17) return ww >= 43 ? [1, 13] : [1, 12, 2]
    if (yy === 16) return ww >= 20 ? [1, 10, 2] : [1, 9, 4]
    if (yy === 15) return [1, 9]
    return [1, 8]
  }
  // 正式版：剥离开发后缀（含 26.2-snapshot-1 / 1.21.11-pre1 / 1.14 Pre-Release 2 三种写法）
  const base = v.split(/[\s-]/)[0]
  const parts = base.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return [999]
  return parts
}

/** 版本族元组比较：返回 -1/0/1。26.x > 全部 1.x；1.21.11 > 1.21.9（数字段比较，非字符串） */
export function compareMcVersions(a: string, b: string): number {
  const fa = mcVersionFamily(a)
  const fb = mcVersionFamily(b)
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const d = (fa[i] ?? 0) - (fb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/** MC 版本是否 ≥ 目标版本。空版本按最新处理（未知实例不丢同步项）。 */
export function mcVersionAtLeast(mcVersion: string, target: string): boolean {
  if (!mcVersion) return true
  return compareMcVersions(mcVersion, target) >= 0
}
