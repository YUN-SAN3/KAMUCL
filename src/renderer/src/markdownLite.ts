/**
 * 轻量 Markdown 渲染（更新日志弹窗专用）：
 * 先整体 HTML 转义（天然防 XSS），再支持 # 标题 / **粗体** / `行内代码` / - 列表 / 链接。
 * 不引第三方依赖；输出仅限安全标签（h4/strong/code/li/a/ul/p）。
 */
export function renderMarkdownLite(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  const lines = String(md ?? '').split(/\r?\n/)
  const out: string[] = []
  let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      out.push(`<h4>${inline(heading[2])}</h4>`)
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(line)
    if (item) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    closeList()
    if (!line.trim()) continue
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('')
}
