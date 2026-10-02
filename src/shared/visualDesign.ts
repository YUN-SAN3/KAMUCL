export interface ComponentDesign {
  x?: number; y?: number; width?: number; height?: number; color?: string; background?: string;
  opacity?: number; radius?: number; blur?: number; fontSize?: number; fontFamily?: string; fontWeight?: number;
  text?: string; hidden?: boolean; order?: number; mode?: 'flow' | 'free'; layer?: number; locked?: boolean; gap?: number; padding?: number
}
export interface PageDesign { width: number; height: number; components: Record<string, ComponentDesign> }
export interface VisualDesign { version: 1; pages: Record<string, PageDesign> }
export const emptyDesign = (): VisualDesign => ({ version: 1, pages: {} })
/** Preserve uniquely identified controls when a layout adds or removes a wrapper.
 * Ambiguous repeated controls never inherit a different control's customization. */
export function resolveComponentDesign(components: Record<string, ComponentDesign> | undefined, key: string): ComponentDesign | undefined {
  if (!components) return
  if (components[key]) return components[key]
  const leaf = key.slice(key.lastIndexOf('/') + 1)
  const matches = Object.keys(components).filter(old => old.slice(old.lastIndexOf('/') + 1) === leaf)
  return matches.length === 1 ? components[matches[0]] : undefined
}
const limits: Record<string, [number, number]> = { x: [-10000,10000], y: [-10000,10000], width: [8,10000], height: [8,10000], opacity: [0,1], radius: [0,300], blur: [0,80], fontSize: [6,200], fontWeight: [100,900], order: [-10000,10000], layer: [0,99], gap:[0,200], padding:[0,200] }
export function cleanDesign(input: unknown): VisualDesign {
  const out = emptyDesign(), value = input as any
  if (!value || value.version !== 1 || !value.pages || typeof value.pages !== 'object') return out
  for (const [page, raw] of Object.entries(value.pages).slice(0,100) as [string,any][]) {
    if (!/^[a-zA-Z0-9/_-]{1,160}$/.test(page) || !raw?.components) continue
    const components: Record<string, ComponentDesign> = Object.create(null)
    for (const [key, source] of Object.entries(raw.components).slice(0,4000) as [string,any][]) {
      if (!/^[a-zA-Z0-9:./_~-]{1,2000}$/.test(key) || !source || typeof source !== 'object') continue
      const style: any = {}
      for (const [name, [min,max]] of Object.entries(limits)) if (typeof source[name] === 'number' && Number.isFinite(source[name])) style[name] = Math.min(max,Math.max(min,source[name]))
      for (const name of ['color','background']) if (typeof source[name] === 'string' && /^(#[a-f0-9]{3,8}|transparent|rgba?\([\d.,%\s]+\))$/i.test(source[name])) style[name]=source[name]
      if (typeof source.fontFamily === 'string' && /^[\p{L}\p{N} ,_-]{1,120}$/u.test(source.fontFamily)) style.fontFamily=source.fontFamily
      if (typeof source.text === 'string') style.text=source.text.slice(0,2000)
      if (typeof source.hidden === 'boolean') style.hidden=source.hidden
      if (typeof source.locked === 'boolean') style.locked=source.locked
      if (source.mode === 'flow' || source.mode === 'free') style.mode=source.mode
      else if (style.x !== undefined || style.y !== undefined) style.mode='free'
      if (Object.keys(style).length) components[key]=style
    }
    out.pages[page] = { width: Math.max(320,Math.min(10000,Number(raw.width)||1280)),height:Math.max(240,Math.min(10000,Number(raw.height)||800)),components }
  }
  return out
}
export function snapped(value: number, targets: number[], enabled = true, threshold = 6): { value: number; guide?: number } {
  if (!enabled) return {value}
  const nearest=targets.reduce<number|undefined>((best,n)=>Math.abs(n-value)<threshold && (best===undefined || Math.abs(n-value)<Math.abs(best-value))?n:best,undefined)
  return nearest===undefined ? {value:Math.round(value/8)*8} : {value:nearest,guide:nearest}
}
