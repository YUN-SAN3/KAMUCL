/** CDP eval on custom port: node scripts/cdp-eval2.mjs <port> <exprfile> */
import fs from 'node:fs'
const port = process.argv[2]
const expression = fs.readFileSync(process.argv[3], 'utf8')
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('no page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const result = await new Promise((resolve, reject) => {
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  socket.addEventListener('message', (event) => {
    const m = JSON.parse(String(event.data))
    if (m.id !== 1) return
    if (m.error) reject(new Error(m.error.message))
    else if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.text || 'eval failed'))
    else resolve(m.result?.result?.value)
  })
  socket.addEventListener('error', () => reject(new Error('socket failed')))
  setTimeout(() => reject(new Error('timeout')), 25000)
})
socket.close()
process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result))
