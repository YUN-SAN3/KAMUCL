import { DEFAULT_BACKGROUND, DEFAULT_LAUNCH_THUMBNAIL, type Settings } from '../../shared/types'
import { carouselImages, MAX_CAROUSEL_IMAGES } from '../../shared/appearancePolicy'

type Purpose = 'background' | 'launch-thumbnail'
export interface AppearanceAssetDependencies {
  getSettings(): Settings
  saveSettings(patch: Partial<Settings>): Settings
  importImage(source: string, purpose: Purpose): Promise<{ path: string }>
  removeImage(image: string, purpose: Purpose): void
}

/** Image imports commit their settings before cleaning up old managed copies. */
export function createAppearanceAssetActions(dependencies: AppearanceAssetDependencies) {
  const { getSettings, saveSettings, importImage, removeImage } = dependencies
  const clean = (images: string[], purpose: Purpose) => {
    for (const image of new Set(images.filter(Boolean))) {
      try { removeImage(image, purpose) } catch { /* A leftover cache must not undo a successful import. */ }
    }
  }
  async function singleBackground(source: string) {
    const imported = await importImage(source, 'background')
    let committed = false
    try {
      const previous = getSettings().background
      const next = saveSettings({ background: { ...previous, mode: 'image', image: imported.path, images: [imported.path], switchMode: 'off' } })
      committed = true
      clean([previous.image, ...(previous.images ?? [])].filter(image => image !== imported.path), 'background')
      return next
    } catch (error) { if (!committed) clean([imported.path], 'background'); throw error }
  }
  async function multipleImages(sources: string[], purpose: Purpose) {
    if (purpose === 'launch-thumbnail' && carouselImages(getSettings().launchThumbnail).length + sources.length > MAX_CAROUSEL_IMAGES) {
      throw new Error(`首页轮播最多 ${MAX_CAROUSEL_IMAGES} 张图片，请先移除部分图片`)
    }
    const imported: string[] = []
    let committed = false
    try {
      for (const source of sources) imported.push((await importImage(source, purpose)).path)
      const current = getSettings()
      let next: Settings
      if (purpose === 'background') {
        const background = current.background
        const existing = background.images?.length ? background.images : background.image ? [background.image] : []
        const images = [...new Set([...existing, ...imported])]
        next = saveSettings({ background: { ...background, mode: 'image', images, image: images[0] ?? background.image } })
      } else {
        const images = [...carouselImages(current.launchThumbnail), ...imported]
        if (images.length > MAX_CAROUSEL_IMAGES) throw new Error(`首页轮播最多 ${MAX_CAROUSEL_IMAGES} 张图片`)
        next = saveSettings({ launchThumbnail: { ...current.launchThumbnail, images, image: images[0] ?? '' } })
      }
      committed = true
      return next
    } catch (error) { if (!committed) clean(imported, purpose); throw error }
  }
  function resetBackground() {
    const previous = getSettings().background
    const next = saveSettings({ background: structuredClone(DEFAULT_BACKGROUND) })
    clean([previous.image, ...(previous.images ?? [])], 'background')
    return next
  }
  function resetLaunchThumbnail() {
    const previous = carouselImages(getSettings().launchThumbnail)
    const next = saveSettings({ launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL) })
    clean(previous, 'launch-thumbnail')
    return next
  }
  return { singleBackground, multipleImages, resetBackground, resetLaunchThumbnail }
}
