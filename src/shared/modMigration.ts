import type { CommunityFile, LoaderName } from './types'
export interface MigrationEntry {
 fileName:string; name:string; currentVersion:string; sha1:string; disabled:boolean;
 status:'compatible'|'unavailable'|'dependency'; reason?:string; target?:CommunityFile
}
export interface ModMigrationPlan {
 id:string; sourceId:string; folder:string; mcVersion:string; loader:LoaderName; loaderVersion:string;
 entries:MigrationEntry[]; warnings:string[]; createdAt:number
}
