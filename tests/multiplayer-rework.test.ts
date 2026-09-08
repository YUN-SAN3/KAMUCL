import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { filterFrpNodes, fetchFrpNodes, type FrpNodeInfo } from '../src/main/core/frpNodes'

const read = (file: string): string => fs.readFileSync(file, 'utf8')
const connectionComponents = ['VoxLinkPanel', 'TerracottaPanel', 'FrpPanel'].map((s) => `src/renderer/src/components/connection/${s}.vue`)
/** 联机模块全部渲染端入口（多页结构后：视图 + 三个方式页面 + 共享面板） */
const multiplayerSources = [
  'src/renderer/src/views/FriendConnectView.vue',
  ...connectionComponents,
  'src/renderer/src/components/connection/ConnectionPanel.vue',
  'src/renderer/src/components/connection/ConnectionStatus.vue',
  'src/renderer/src/components/connection/connection.css'
]

test('联机文案纠错：多页全部文件不得出现「一点即连/一键联机/输码即连/备选/在多人游戏中查看/玩家直连」', () => {
  for (const file of multiplayerSources) {
    const source = read(file)
    for (const banned of ['一点即连', '一键联机', '输码即连', '在多人游戏中查看', '备选方案', 'VoxLink 的备选', 'VoxLink 备选', '玩家直连']) {
      assert.ok(!source.includes(banned), `${file} 不应出现「${banned}」`)
    }
  }
  const view = read('src/renderer/src/views/FriendConnectView.vue')
  // 方式选择页三张卡片：准确介绍 + 适用场景标签
  for (const text of ['注册樱花穿透（natfrp.com）并创建隧道', '公网隧道 · 最稳', 'UDP 打洞 + STUN 的 P2P 直连，游戏数据不经服务器', '6 位房间码 · 免公网 IP', '打通后仍需在游戏内「直接连接」填入地址', '独立开源联机项目', 'burningtnt/Terracotta', '独立开源 · 开箱即用']) {
    assert.ok(view.includes(text), `方式选择页缺少：${text}`)
  }
  // 三张横向卡片各配一句适用场景
  for (const scene of ['适合追求稳定', '适合双方网络尚可', '适合不想配置任何参数']) {
    assert.ok(view.includes(scene), `方式选择页缺少场景标签：${scene}`)
  }
  // 方式选择页恰好三张卡片（FRP / VoxLink / 陶瓦）
  assert.equal((view.match(/key: '/g) ?? []).length, 3)
})

test('联机多页结构：landing=方式选择，每种方式独立页并保留「← 更换方式」返回', () => {
  const view = read('src/renderer/src/views/FriendConnectView.vue')
  // 页面路由：choose 为 landing，三种方式各自独立页
  for (const key of ["'choose'", "'frp'", "'voxlink'", "'terracotta'"]) assert.ok(view.includes(key), `缺少页面态 ${key}`)
  assert.ok(view.includes("v-if=\"page === 'choose'\""), 'landing 应为方式选择页')
  assert.ok(view.includes("v-if=\"page === 'frp'\""), 'FRP 应是独立页面')
  assert.ok(view.includes("v-else-if=\"page === 'voxlink'\""), 'VoxLink 应是独立页面')
  assert.ok(view.includes("v-else-if=\"page === 'terracotta'\""), '陶瓦应是独立页面')
  assert.ok(view.includes('← 更换方式'), '独立页必须保留「← 更换方式」返回')
  // 方式卡片只剩三张（玩家直连卡片已删除）
  assert.ok(!view.includes("'direct'"), '不得残留玩家直连页面态')
})

test('FRP 页重排：一键开始 + 状态区/主操作区/参考折叠/日志窄区 + 宽松节点行', () => {
  const panel = read('src/renderer/src/components/connection/FrpPanel.vue')
  // 主流程：一键开始（上次配置预填） + 刷新状态
  for (const text of ['启动 frpc', '刷新状态', 'userData/frp-config.json', 'frp:status', 'frp:start']) {
    assert.ok(panel.includes(text), `FrpPanel 缺少：${text}`)
  }
  // 节点参考与运行日志默认折叠（details 不带 open 属性）
  assert.match(panel, /<details class="reference-details"(?:\s[^>]*)?>/ )
  assert.match(panel, /<details class="connection-details log-details">(?:\s[^>]*)?>/)
  assert.ok(!panel.includes(' open'), '折叠区默认不得展开（不应出现 open 属性）')
  // 节点列表：宽松行（自适应高度 + 内边距），行间距 ≥ --space-2，不再固定小行高
  const scoped = panel.slice(panel.indexOf('<style'))
  assert.match(scoped, /\.node-item \{[^}]*align-items: flex-start/)
  assert.match(scoped, /\.node-item \{[^}]*padding: var\(--space-3\) var\(--space-4\)/)
  assert.match(scoped, /\.node-list \{[^}]*gap: var\(--space-3\)/)
  assert.match(scoped, /\.node-item \{[^}]*min-height: var\(--row-h\)/)
  assert.ok(!/\.node-item \{[^}]*height: \d/.test(scoped), '节点行不得固定高度（会重叠贴死）')
  // 我的隧道小卡位于节点列表上方
  const tunnelsAt = panel.indexOf('我的隧道')
  const listAt = panel.indexOf('class="node-list"')
  assert.ok(tunnelsAt > -1 && listAt > tunnelsAt, '我的隧道小卡应在节点列表上方')
  // 高级选项（本地端口自动识别）折叠；远程地址+复制在状态卡
  assert.ok(panel.includes('高级选项 · 本地端口'), '本地端口应放高级折叠区')
  assert.ok(panel.includes('复制地址'), '远程地址应可复制')
  for (const text of ['只看免费节点', "'免费'", "'专业版'", '节点由 natfrp 后台创建隧道时选择', '负载', '直接连接']) {
    assert.ok(panel.includes(text), `FrpPanel 缺少：${text}`)
  }
})

test('FRP 节点数据层：接口/字段注释、IPC 通道、筛选逻辑与免费判定', async () => {
  const nodes = read('src/main/core/frpNodes.ts')
  for (const text of ['https://api.natfrp.com/v4', '/nodes', '/node/stats', '/tunnels', 'Authorization: Bearer', 'vip', 'flag', '缓存 10 分钟']) {
    assert.ok(nodes.includes(text), `frpNodes.ts 缺少数据来源/字段说明：${text}`)
  }
  // 免费节点筛选逻辑（vip === 0 视为免费）
  const node = (id: number, vip: number, load = 10): FrpNodeInfo => ({ id, name: `n${id}`, host: 'h', description: '', vip, free: vip === 0, online: true, load, udp: false, mainland: false, canCreate: true, noProtect: false, beta: false })
  const list = [node(1, 2), node(2, 0), node(3, 0, 5), node(4, 7)]
  assert.deepEqual(filterFrpNodes(list, true).map((n) => n.id), [2, 3])
  assert.equal(filterFrpNodes(list, false).length, 4)
  // 无密钥时抛真实错误（不触网）
  await assert.rejects(fetchFrpNodes(''), /访问密钥/)

  assert.ok(read('src/main/core/frpIpc.ts').includes("nodes: 'frp:nodes'"), 'frpIpc 必须注册 frp:nodes')
  assert.ok(read('src/shared/types.ts').includes("frpNodes: 'frp:nodes'"), 'types.ts 必须追加 frp:nodes 常量')
})

test('陶瓦房间码：实现与文案统一为 U/ + 四段（U/XXXX-XXXX-XXXX-XXXX），页面按分区排布', () => {
  const tc = read('src/main/core/terracotta.ts')
  assert.ok(tc.includes('/^U\\/[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/'), 'terracotta.ts 应保留四段房间码正则')
  assert.ok(!/U\/XXXX-XXXX-XXXX(?![\-X])/.test(tc.replace(/U\/XXXX-XXXX-XXXX-XXXX/g, '')), 'terracotta.ts 不得残留三段式房间码描述')
  assert.ok(tc.includes('U/XXXX-XXXX-XXXX-XXXX'), '注释/报错应使用四段格式')
  const panel = read('src/renderer/src/components/connection/TerracottaPanel.vue')
  assert.ok(panel.includes('U/XXXX-XXXX-XXXX-XXXX'), '面板占位符应为四段')
  assert.ok(!panel.includes('U/XXXX-XXXX-XXXX"'), '面板不得残留三段占位符')
  // 正则行为抽查
  const re = /^U\/[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/
  assert.ok(re.test('U/AB12-CD34-EF56-GH78'))
  assert.ok(!re.test('U/AB12-CD34-EF56'))
  assert.ok(!re.test('U/AB12-CD34-EF56-GH78-9'))
  // 分区结构：状态区 → 主操作区 → 参考折叠 → 日志窄区
  const statusAt = panel.indexOf('title="连接状态"')
  const opsAt = panel.indexOf('title="开始联机"')
  const refAt = panel.indexOf('reference-details')
  const logAt = panel.indexOf('log-details')
  assert.ok(statusAt > -1 && opsAt > statusAt && refAt > opsAt && logAt > refAt, '陶瓦页应按 状态→主操作→参考→日志 顺序向下分区')
  for (const text of ['多人游戏', '直接连接', '复制地址', 'burningtnt/Terracotta', 'SHA-256', 'U/ 开头的房间码发给好友（官方四段格式）']) {
    assert.ok(panel.includes(text), `TerracottaPanel 缺少：${text}`)
  }
})

test('VoxLink 集成补全：后备 IPC、阶段事件、已连接判定、消敏日志与页内 Tab', () => {
  const index = read('src/main/core/voxlink/index.ts')
  for (const channel of ["'voxlink:tryDirect'", "'voxlink:usePlayerRelay'"]) assert.ok(index.includes(channel), `index.ts 缺少 ${channel}`)
  const shared = read('src/shared/types.ts')
  for (const key of ['voxlinkTryDirect', 'voxlinkUsePlayerRelay']) assert.ok(shared.includes(key), `types.ts 缺少 ${key}`)

  const engine = read('src/main/core/voxlink/engine.ts')
  for (const key of ["emitStage('stun'", "emitStage('punch'", "emitStage('relay'", "emitStage('host_stun'", "emitStage('host_punch'"]) {
    assert.ok(engine.includes(key), `engine.ts 缺少阶段事件 ${key}`)
  }

  const panel = read('src/renderer/src/components/connection/VoxLinkPanel.vue')
  for (const text of ['尝试直连', '使用玩家中继', '房间已加入，正在建立 P2P 连接…', '多人游戏', '直接连接', '复制地址', 'sanitizeLog', "'stage'", "'conn:state'", '阶段', '复制日志', '300 秒', '不含 I、L、O、0、1']) {
    assert.ok(panel.includes(text), `VoxLinkPanel 缺少：${text}`)
  }
  assert.ok(!panel.includes('已连接到房主'), '不得保留过早的「已连接到房主」')
  // 公共大厅/建房/加入用页内 Tab 分开
  for (const text of ['connect-tab', "tab === 'host'", "tab === 'join'", "tab === 'lobby'", '公共大厅']) {
    assert.ok(panel.includes(text), `VoxLinkPanel 应使用页内 Tab 分开入口，缺少：${text}`)
  }
  // 分区结构：状态区 → 主操作区 → 参考折叠 → 日志窄区
  const statusAt = panel.indexOf('title="连接状态"')
  const opsAt = panel.indexOf('title="开始联机"')
  const refAt = panel.indexOf('reference-details')
  const logAt = panel.indexOf('log-details')
  assert.ok(statusAt > -1 && opsAt > statusAt && refAt > opsAt && logAt > refAt, 'VoxLink 页应按 状态→主操作→参考→日志 顺序向下分区')
  // 「已连接」只允许出现在 connected 分支内（静态断言）
  const template = panel.slice(panel.indexOf('<template>'))
  const connectedStart = template.indexOf('v-else-if="connected"')
  const connectedEnd = template.indexOf('<template v-else>', connectedStart)
  assert.ok(connectedStart > -1 && connectedEnd > connectedStart, '模板必须保留 connected 分支结构')
  const before = template.slice(0, connectedStart)
  const branch = template.slice(connectedStart, connectedEnd)
  assert.ok(!before.includes('已连接'), 'connected 之前的模板不得出现「已连接」')
  assert.ok(branch.includes('已连接'), 'connected 分支内应有「已连接」状态')
})

test('重排后的联机组件可编译且遵守配色铁律（无十六进制/rgb 字面量）', () => {
  const files = [...multiplayerSources.filter((f) => f.endsWith('.vue')), 'src/renderer/src/components/connection/ServerListItem.vue', 'src/renderer/src/components/connection/ServerDetails.vue']
  for (const file of files) {
    const source = read(file)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], file)
    const script = compileScript(descriptor, { id: file })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [], file)
    for (const style of descriptor.styles) assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(style.content), file)
  }
  const css = read('src/renderer/src/components/connection/connection.css')
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css))
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /focus-visible/)
  assert.match(css, /grid-template-columns: 1fr/)
  // 区块间距回归设计令牌：区块间 --sec-gap，日志窄区共享样式存在
  assert.match(css, /\.connection-log-viewport \{[^}]*max-height: 180px/)
  assert.match(read('src/renderer/src/components/connection/FrpPanel.vue'), /gap: var\(--sec-gap\)/)
  assert.match(read('src/renderer/src/components/connection/VoxLinkPanel.vue'), /gap: var\(--sec-gap\)/)
  assert.match(read('src/renderer/src/components/connection/TerracottaPanel.vue'), /gap: var\(--sec-gap\)/)
})
