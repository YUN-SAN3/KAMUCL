import { nativeImage, type WebContents } from 'electron'
export { dragResourceFiles } from './resourceDragPaths'

export function startNativeFileDrag(sender: WebContents, files: string[]) {
  if (sender.isDestroyed() || !files.length) return
  // A local bitmap avoids network icons delaying the user's drag gesture.
  const pixels = Buffer.alloc(32 * 32 * 4)
  for (let y = 3; y < 29; y++) for (let x = 6; x < 26; x++) {
    const i = (y * 32 + x) * 4
    pixels[i] = 70; pixels[i + 1] = 155; pixels[i + 2] = 240; pixels[i + 3] = 255
  }
  sender.startDrag({ file: files[0], files, icon: nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }) })
}
