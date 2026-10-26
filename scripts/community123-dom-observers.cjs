// Functions are parsed as ordinary Node JavaScript before being serialized to the
// isolated renderer. They observe public DOM only and never dispatch UI actions.
function state() {
  const status = document.querySelector('[data-search123=status]')
  return {
    phase: status?.dataset.phase, id: status?.dataset.requestId,
    revision: Number(status?.dataset.revision),
    titles: [...document.querySelectorAll('.result-title')].map(e => e.textContent.trim()),
    keys: [...document.querySelectorAll('[data-project-key]')].map(e => e.dataset.projectKey),
    keyword: document.querySelector('[data-search123=keyword]')?.value,
    version: document.querySelector('[aria-label="Minecraft 版本"]')?.value || '',
    status: status?.textContent.trim(), focus: document.activeElement?.dataset.search123Action,
  }
}
function point(selector) {
  const element = document.querySelector(selector)
  if (!element) return { missing: true, selector }
  const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
  const hit = document.elementFromPoint(x, y)
  return {
    x, y, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    label: element.textContent.trim(), disabled: !!element.disabled,
    blocked: hit !== element && !element.contains(hit),
    hit: hit && { tag: hit.tagName, class: hit.className, ui: hit.dataset.ui, id: hit.id, label: hit.textContent?.trim().slice(0, 120) },
    viewport: { width: innerWidth, height: innerHeight },
  }
}
function scrollTarget(selector) {
  const element = document.querySelector(selector)
  if (!element) return false
  element.scrollIntoView({ block: 'center' })
  return true
}
const expression = (fn, ...args) => '(' + fn.toString() + ')(' + args.map(arg => JSON.stringify(arg)).join(',') + ')'
module.exports = { state, point, scrollTarget, expression }
