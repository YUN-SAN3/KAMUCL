import type { BackgroundSettings, LaunchThumbnailSettings } from './types'
import { BUILTIN_LAUNCH_IMAGES } from './launchImages'

export const MAX_CAROUSEL_IMAGES = 20
export function carouselDuration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(120, value)) : 6.5
}
export function carouselTiming(settings: Partial<LaunchThumbnailSettings>) {
  const allowed = new Set(carouselKeys(settings))
  return { intervalSeconds: carouselDuration(settings.intervalSeconds), durations: Object.fromEntries(Object.entries(settings.durations ?? {}).filter(([image]) => allowed.has(image)).map(([image, value]) => [image, carouselDuration(value)])) }
}
/** `images` is authoritative, including []; old single-image settings remain readable. */
export function carouselImages(thumbnail?: Partial<LaunchThumbnailSettings>): string[] {
  const values = Array.isArray(thumbnail?.images) ? thumbnail.images : [thumbnail?.image]
  return [...new Set(values.filter((s): s is string => typeof s === 'string' && !!s.trim()))].slice(0, MAX_CAROUSEL_IMAGES)
}

/** All retained pictures, including disabled pictures: selection never removes user files. */
export function carouselKeys(thumbnail?: Partial<LaunchThumbnailSettings>): string[] {
  const available = [...BUILTIN_LAUNCH_IMAGES.map(image => image.key), ...carouselImages(thumbnail)]
  const allowed = new Set(available)
  const order = Array.isArray(thumbnail?.order) ? thumbnail.order : []
  return [...new Set([...order.filter(key => typeof key === 'string' && allowed.has(key)), ...available])]
}

export function carouselSelection(thumbnail?: Partial<LaunchThumbnailSettings>): { order: string[]; disabled: string[] } {
  const order = carouselKeys(thumbnail)
  const allowed = new Set(order)
  const disabled = Array.isArray(thumbnail?.disabled) ? thumbnail.disabled : []
  return { order, disabled: [...new Set(disabled.filter(key => typeof key === 'string' && allowed.has(key)))] }
}

export function activeCarouselKeys(thumbnail?: Partial<LaunchThumbnailSettings>): string[] {
  const { order, disabled } = carouselSelection(thumbnail)
  const skipped = new Set(disabled)
  return order.filter(key => !skipped.has(key))
}

export function backgroundImageEffect(bg: Pick<BackgroundSettings, 'opacity' | 'blur'>) {
  const opacity = Math.max(0, Math.min(1, Number.isFinite(bg.opacity) ? bg.opacity : .5))
  const blur = Math.max(0, Math.min(40, Number.isFinite(bg.blur) ? bg.blur : 0))
  return { opacity: String(opacity), filter: blur > 0 ? `blur(${blur}px)` : 'none' }
}
