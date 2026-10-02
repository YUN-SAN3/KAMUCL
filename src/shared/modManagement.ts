import type { CommunityFile } from './types'
export interface ManagedMod { fileName:string; name:string; version:string; sha1:string; fingerprint?:number; locked:boolean; identity?:string; error?:string }
export interface ModOperationResult { fileName:string; ok:boolean; name?:string; error?:string }
export interface ModVersionChoices { id:string; fileName:string; name:string; currentVersion:string; mcVersion:string; loader:string; locked:boolean; files:CommunityFile[] }
export interface ModChangePlan { id:string; fileName:string; target:CommunityFile; files:Array<{fileName:string;version:string;dependency:boolean}>; warnings:string[]; changelog:string }
