import type { GameResolution } from '../../shared/types'
import type { GameProcessHandle } from './gracefulClose'
import { resolutionValidationError } from './gameWindow'

export interface GameWindowSample { pid: number; width: number; height: number; windowed: boolean }
type WindowReader = (pid: number) => Promise<GameWindowSample | undefined>
let nativeReader: Promise<WindowReader> | undefined

/** Read-only Windows observation. No focus, input, resize or other-game mutation. */
export async function readOwnedGameWindow(pid: number): Promise<GameWindowSample | undefined> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return undefined
  const read = await (nativeReader ??= (async () => {
    const { default: k } = await import('koffi')
    const u = k.load('user32.dll')
    const rect = k.struct('KamuclGameSizeRect117', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    const callback = k.proto('bool __stdcall KamuclGameSizeEnum117(uintptr hwnd, intptr unused)')
    const enumerate = u.func('EnumWindows', 'bool', [k.pointer(callback), 'intptr'])
    const owner = u.func('GetWindowThreadProcessId', 'uint32', ['uintptr', k.out(k.pointer('uint32'))])
    const visible = u.func('bool __stdcall IsWindowVisible(uintptr)')
    const minimized = u.func('bool __stdcall IsIconic(uintptr)')
    const maximized = u.func('bool __stdcall IsZoomed(uintptr)')
    const className = u.func('GetClassNameW', 'int', ['uintptr', 'void *', 'int'])
    const style = u.func('int32 __stdcall GetWindowLongW(uintptr, int)')
    const client = u.func('GetClientRect', 'bool', ['uintptr', k.out(k.pointer(rect))])
    return async (expected: number) => {
      const matches: GameWindowSample[] = []
      enumerate((hwnd: number) => {
        const pidOut = [0]
        owner(hwnd, pidOut)
        if (pidOut[0] !== expected || !visible(hwnd) || minimized(hwnd) || maximized(hwnd)) return true
        const name = Buffer.alloc(512)
        className(hwnd, name, 256)
        if (!/GLFW|LWJGL/i.test(name.toString('utf16le').split('\0')[0])) return true
        // Fullscreen/borderless windows do not have a normal resizable frame.
        if (!(Number(style(hwnd, -16)) & 0x00040000)) return true
        const size = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!client(hwnd, size)) return true
        owner(hwnd, pidOut)
        if (pidOut[0] === expected) matches.push({ pid: expected, width: size.right, height: size.bottom, windowed: true })
        return true
      }, 0)
      // Never guess which of multiple owned game windows is the actual game.
      return matches.length === 1 ? matches[0] : undefined
    }
  })())
  return read(pid)
}

export function validWindowSize(sample: GameWindowSample | undefined, pid: number): sample is GameWindowSample {
  return !!sample && sample.pid === pid && sample.windowed && !resolutionValidationError({ width: sample.width, height: sample.height, mode: 'windowed', fullscreen: false })
}

/** Explicit preference changes, including adding/removing an instance override, win. */
export function rememberedWindowResolution(initial: GameResolution, initialInstance: GameResolution | undefined,
  currentGlobal: GameResolution, currentInstance: GameResolution | undefined, size: Pick<GameResolution, 'width' | 'height'>): GameResolution | undefined {
  if (!!initialInstance !== !!currentInstance) return undefined
  const current = currentInstance ?? currentGlobal
  if (JSON.stringify(current) !== JSON.stringify(initial)) return undefined
  return { ...current, width: size.width, height: size.height }
}

/** Only the accepted owned process is sampled, and only clean exit commits once. */
export function watchGameWindowSize(child: GameProcessHandle, options: {
  enabled: () => boolean
  commit: (size: Pick<GameResolution, 'width' | 'height'>) => void
  onError: (error: unknown) => void
  read?: WindowReader
  intervalMs?: number
}): { finish: (cleanExit: boolean) => boolean } {
  const pid = child.pid
  if (!pid || !Number.isSafeInteger(pid) || !options.enabled()) return { finish: () => false }
  let active = true, reported = false, latest: GameWindowSample | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const report = (error: unknown) => { if (!reported) { reported = true; options.onError(error) } }
  const sample = () => {
    if (!active || child.exitCode !== null || child.signalCode !== null) return
    void (async () => {
      try {
        const value = await (options.read ?? readOwnedGameWindow)(pid)
        if (active && options.enabled() && validWindowSize(value, pid)) latest = value
      } catch (error) { if (active) report(error) }
      finally { if (active) { timer = setTimeout(sample, options.intervalMs ?? 500); timer.unref?.() } }
    })()
  }
  sample()
  return { finish: cleanExit => {
    if (!active) return false
    active = false
    if (timer) clearTimeout(timer)
    if (!cleanExit || !latest || !options.enabled()) return false
    try { options.commit({ width: latest.width, height: latest.height }); return true }
    catch (error) { report(error); return false }
  } }
}
