/** Maven conflict identity: child version overrides parent, classifiers/types remain distinct. */
export function mavenIdentity(name: string | undefined, classifier?: string): string | undefined {
  if (!name) return undefined
  const [coordinate, extension = 'jar'] = name.split('@')
  const parts = coordinate.split(':')
  if (parts.length < 3 || parts.length > 4 || parts.some(p => !p)) return undefined
  return `${parts[0]}:${parts[1]}:${classifier ?? parts[3] ?? ''}@${extension}`
}
