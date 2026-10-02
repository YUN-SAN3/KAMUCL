/** Stable keys keep image selection and timing independent of bundled asset hashes. */
export const BUILTIN_LAUNCH_IMAGES = [
  { key: 'builtin:piston', title: 'Minecraft活塞压扁大冒险', file: 'piston.webp' },
  { key: 'builtin:brewer', title: '暮色村庄酿药师', file: 'brewer.webp' },
  { key: 'builtin:cannon', title: '熔岩悬崖上的失控大炮', file: 'cannon.webp' },
  { key: 'builtin:cactus', title: '沙漠仙人掌飞跃大作战', file: 'cactus.webp' },
  { key: 'builtin:farmer', title: '像素农夫与肥料伙伴', file: 'farmer.webp' },
  { key: 'builtin:camp', title: '月夜篝火下的方块森林营地', file: 'camp.webp' },
  { key: 'builtin:sunset', title: '方块世界的日落奇遇', file: 'sunset.webp' }
] as const

export function isBuiltinLaunchImage(key: string): boolean {
  return BUILTIN_LAUNCH_IMAGES.some(image => image.key === key)
}
