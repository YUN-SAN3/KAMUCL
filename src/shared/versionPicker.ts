import type { RemoteVersion } from './types'
export type VersionCategory='release'|'preview'|'snapshot'|'old'|'all'
export const versionCategories:{value:VersionCategory;label:string}[]=[{value:'release',label:'正式版'},{value:'preview',label:'预发布 / 候选'},{value:'snapshot',label:'快照'},{value:'old',label:'远古版'},{value:'all',label:'全部'}]
export function versionCategory(v:RemoteVersion):VersionCategory{
 if(v.type==='release')return 'release'
 if(v.type==='old_alpha'||v.type==='old_beta')return 'old'
 return /(?:[-\s](?:pre|rc)(?:[-\s]?\d|release)|pre-release|release candidate)/i.test(v.id)?'preview':'snapshot'
}
export function filterVersions(versions:RemoteVersion[],category:VersionCategory,query:string){const q=query.trim().toLowerCase();return versions.filter(v=>(category==='all'||versionCategory(v)===category)&&v.id.toLowerCase().includes(q)).sort((a,b)=>Date.parse(b.releaseTime)-Date.parse(a.releaseTime))}
