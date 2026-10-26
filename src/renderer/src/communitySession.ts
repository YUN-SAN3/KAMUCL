import type { CommunityQuery, CommunityResult, CommunitySearchSnapshot } from '@shared/types'
import type { CommunityVersionSelection } from './communityVersionSelection'

/** Route-local, memory-only history: leaving the page releases its DOM and dialogs. */
export interface CommunitySession {
  query: Omit<CommunityQuery, 'offset' | 'limit'>
  tab: 'browse' | 'favorites'
  favoriteSearch: string
  versionInput: string
  versionSelection?: CommunityVersionSelection
  results: CommunityResult[]
  searched: boolean
  error: string
  offset: number
  hasMore: boolean
  page: number
  total: number
  warnings: string[]
  scrollTop: number
  topKeyword: string
  interrupted: boolean
  /** Saved visible prefix and remaining discovery are retained while its sender
   * subscription is cancelled. Returning explicitly resumes with a fresh ID. */
  progressive?: { snapshot: CommunitySearchSnapshot; paused: boolean }
}
let last: CommunitySession | undefined
export function saveCommunitySession(value: CommunitySession): void {
  last = JSON.parse(JSON.stringify(value)) as CommunitySession
}
export function readCommunitySession(): CommunitySession | undefined {
  return last ? structuredClone(last) : undefined
}
export function clearCommunitySession(): void { last = undefined }
