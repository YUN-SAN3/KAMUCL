/** CDP Page.captureScreenshot：截 KAMUCL 渲染页（不受遮挡窗口影响）。用法：node scripts/cdp-shot.mjs out.png */
import fs from 'node:fs'
const out = process.argv[2] || 'cdp-shot.png'
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find((t) => t.type === 'page' && t.title === 'KAMUCL')
if (!page) throw new Error('KAMUCL page not found')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })
  socket.addEventListener('message', (event) => {
    const m = JSON.parse(String(event.data))
    if (m.id !== 1) return
    if (m.error) reject(new Error(m.error.message))
    else resolve(m.result.data)
  })
  socket.addEventListener('error', reject)
  setTimeout(() => reject(new Error('timeout')), 15000)
}).then((data) => {
  fs.writeFileSync(out, Buffer.from(data, 'base64'))
  console.log('saved', out)
})
socket.close()
