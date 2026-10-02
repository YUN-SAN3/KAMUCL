/** Display helpers only: never rename files or change operation identities. */
export function resourceDisplayName(name: string): string { return name.replace(/^KAMUCL-default-[a-f0-9]{64}-(?=.+)/, '') }
export function pageSelection(names: string[], selected: ReadonlySet<string>) { const count=names.filter(name=>selected.has(name)).length; return { all:names.length>0&&count===names.length,partial:count>0&&count<names.length } }
export function terracottaRole(state: { phase: string; room?: string; url?: string } | null) { return state?.phase === 'ready' ? state.url ? 'guest' : state.room ? 'host' : 'none' : state?.phase === 'joining' ? 'guest' : state?.phase === 'hosting' ? 'host' : 'none' }
