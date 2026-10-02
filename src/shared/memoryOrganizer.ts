export interface MemoryOrganizeResult { applicable: boolean; beforeMB: number; afterMB: number; processed: number; skipped: number; failures: Record<string,number>; elapsedMs: number }
export function shouldSkipMemoryProcess(pid:number, executable:string, protectedPids:number[], windowsDirectory:string):boolean {
  const name=executable.replace(/\\/g,'/').split('/').pop()?.toLowerCase()||''
  const p=executable.replace(/\\/g,'/').toLowerCase(), system=windowsDirectory.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase()
  return pid<=4 || protectedPids.includes(pid) || !name || /^(javaw?|minecraft.*|dwm|csrss|lsass|smss|wininit|winlogon|services)\.exe$/.test(name) || (system!=='' && p.startsWith(system+'/'))
}
