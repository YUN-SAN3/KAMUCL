import type { InstanceTarget } from './instanceCenter'
export type ProjectionFormat='litematic'|'schem'|'schematic'|'nbt'
export interface ProjectionEntry {id:string;folder?:string;name:string;kind:ProjectionFormat;size:number;modified:number;source:string;directory:string;library:boolean;blocks?:number;dataVersion?:number;gameVersion?:string;error?:string}
export interface ProjectionCatalog {entries:ProjectionEntry[];warnings:string[];library:string;instances:Array<InstanceTarget&{name:string}>}
export interface ProjectionDifference {key:string;kind:'block'|'entity'|'blockEntity'|'data';description:string;count:number;replacement?:string;discardOnly?:boolean}
export interface ProjectionAnalysis {id:string;sourceFormat:ProjectionFormat;targetFormat:ProjectionFormat;sourceVersion?:string;targetVersion?:string;differences:ProjectionDifference[];blocks:number;unsupported?:string;sourceHash:string}
export interface ProjectionChoices { [key:string]:string }
export type ProjectionRequest=import('./recordings').RecordingRequest
export type ProjectionResult=import('./recordings').RecordingResult
