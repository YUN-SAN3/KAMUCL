import snapshot from './projectionRegistries.json'
export function minecraftData(version:string):any{const hash=(snapshot.registry as Record<string,string>)[version];if(!hash)return undefined;return {blocksByName:(snapshot.schemas as Record<string,unknown>)[hash],blocksArray:true}}
export namespace minecraftData { export const legacy={pc:{blocks:snapshot.legacy}};export const versions={pc:snapshot.supported.map(v=>({minecraftVersion:v.version,dataVersion:v.dataVersion,releaseType:'release'}))} }
