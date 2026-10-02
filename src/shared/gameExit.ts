export type GameExitKind = 'normal' | 'stopped' | 'shutdown-timeout' | 'abnormal'

/** Windows exposes DWORD exit statuses; preserve raw values in logs and show signed codes. */
export function signedExitCode(code: number | null): number | null {
  return code !== null && code >= 0 && code <= 0xffffffff ? code | 0 : code
}

/** Evidence belongs only to the current process output, never another session's latest.log. */
export class GameExitEvidence {
  private stopping = false
  private shutdownWatchdog = false
  private otherFailure = false
  private reports = 0
  private describedReports = 0

  observe(line: string): void {
    if (/\[(?:Render thread|Client thread)\/INFO\](?:\s*\[[^\]]+\])?:\s*Stopping!\s*$/.test(line)) this.stopping = true
    if (/^---- Minecraft Crash Report ----\s*$/.test(line)) this.reports++
    if (this.reports > this.describedReports && /^Description:\s*/.test(line)) {
      this.describedReports++
      if (this.stopping && /^Description: Client shutdown from post-main\s*$/.test(line)) this.shutdownWatchdog = true
      else this.otherFailure = true
    }
    if (/A fatal error has been detected by the Java Runtime Environment|Encountered an unexpected exception|Reported exception thrown!|Exception in thread "(?:main|Render thread|Client thread)"/.test(line)) this.otherFailure = true
  }

  classify(code: number | null, intentional = false, platform = 'win32'): GameExitKind {
    if (intentional) return 'stopped'
    if (code === 0) return 'normal'
    // -8 alone is not sufficient. A real crash followed by cleanup must still be reported.
    if (platform === 'win32' && signedExitCode(code) === -8 && this.stopping && this.shutdownWatchdog && !this.otherFailure && this.reports === this.describedReports) return 'shutdown-timeout'
    return 'abnormal'
  }
}

export function shouldReportGameCrash(state: { code?: number; exitKind?: GameExitKind; intentionalStop?: boolean; intentionalRestart?: boolean }): boolean {
  if (state.intentionalStop || state.intentionalRestart) return false
  return state.exitKind ? state.exitKind === 'abnormal' : state.code !== undefined && state.code !== 0
}
