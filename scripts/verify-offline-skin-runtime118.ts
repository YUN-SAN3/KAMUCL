import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fetch, ProxyAgent } from 'undici'
import sharp from 'sharp'
import { createOfflineSkinLaunch } from '../src/main/core/offlineSkinLaunch'

async function main() {
  const root = path.resolve('out/offline118/native-' + crypto.randomUUID()); fs.mkdirSync(root, { recursive: true })
  const proof: any = { complete:false, classification:'Real official manifests, checksum-verified client authlib and injector; native JVM secure texture decoding. This is not a Minecraft world/rendering claim.', cases:[] }
  const save = () => fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(proof,null,2))
  save()
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy, dispatcher = proxy ? new ProxyAgent(proxy) : undefined
  const read = async (url:string, sha1?:string) => {
    assert(new URL(url).protocol === 'https:'); assert(['piston-meta.mojang.com','libraries.minecraft.net','authlib-injector.yushi.moe'].includes(new URL(url).hostname))
    const response = await fetch(url,{dispatcher,signal:AbortSignal.timeout(30000)}); assert.equal(response.status,200)
    const bytes = Buffer.from(await response.arrayBuffer()); if (sha1) assert.equal(crypto.createHash('sha1').update(bytes).digest('hex'),sha1)
    return bytes
  }
  try {
    const manifest = JSON.parse((await read('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toString())
    const injectorMeta = JSON.parse((await read('https://authlib-injector.yushi.moe/artifact/latest.json')).toString())
    const injectorBytes = await read(injectorMeta.download_url); assert.equal(crypto.createHash('sha256').update(injectorBytes).digest('hex'), injectorMeta.checksums.sha256)
    const injector = path.join(root,'authlib-injector.jar'); fs.writeFileSync(injector,injectorBytes); proof.injector=injectorMeta
    execFileSync(process.execPath,['scripts/build-offline-skin-agent.cjs'],{stdio:'pipe',windowsHide:true})
    const javaRoot = process.env.JAVA_HOME || 'C:/Program Files/Java/jdk-25.0.2'
    execFileSync(path.join(javaRoot,'bin/javac.exe'),['--release','8','-d',root,'tests/fixtures/OfflineAuthlibProbe.java'],{stdio:'pipe',windowsHide:true})
    const bytes = await sharp({create:{width:64,height:64,channels:4,background:'#ce8550'}}).png().toBuffer(), skin = path.join(root,'synthetic-skin.png'),sha256=crypto.createHash('sha256').update(bytes).digest('hex'); fs.writeFileSync(skin,bytes)
    for (const [id,java] of [['1.12.2',process.env.KAMUCL_JAVA8_ROOT || 'C:/Program Files/Java/jdk-17'],['1.20.1','C:/Program Files/Java/jdk-17'],['1.21.11','C:/Program Files/Java/jdk-21.0.12'],['26.3','C:/Program Files/Java/jdk-25.0.2']]) {
      const row:any = {id, java, complete:false}; proof.cases.push(row); save()
      const entry=manifest.versions.find((v:any)=>v.id===id); assert(entry)
      const versionBytes=await read(entry.url,entry.sha1), version=JSON.parse(versionBytes.toString()); row.manifest={url:entry.url,sha1:entry.sha1,java:version.javaVersion}
      const libs=version.libraries.filter((l:any)=>/^(?:com\.mojang:authlib:|com\.google\.|org\.slf4j:slf4j-api:|org\.apache\.logging\.log4j:|org\.apache\.commons:commons-lang3:|commons-io:|commons-codec:|commons-logging:)/.test(l.name)).map((l:any)=>l.downloads.artifact)
      const cp=[root]; row.libraries=[]
      for (const lib of libs) { const file=path.join(root,'libraries',lib.path); if(!fs.existsSync(file)) {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,await read(lib.url,lib.sha1))} assert.equal(crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'),lib.sha1);cp.push(file);row.libraries.push({path:lib.path,sha1:lib.sha1}) }
      const account={id:'synthetic-offline',type:'offline' as const,username:'OfflineSkinProbe',uuid:'c430be75-2e7a-37ab-839f-44d28d4a52f0'}
      const launch=await createOfflineSkinLaunch(account,{filePath:skin,sha256,variant:'slim'},path.resolve('offline-skin-agent/dist/kamucl-offline-skin.jar'),injector,root)
      try {
        await launch.releasePort()
        row.output=execFileSync(path.join(java,'bin/java.exe'),[...launch.args,'-cp',cp.join(path.delimiter),'OfflineAuthlibProbe',account.uuid,account.username,sha256,'slim'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:45000,stdio:'pipe'})
        assert(row.output.includes('OFFICIAL_AUTHLIB_SKIN_OK'));row.complete=true;save()
      } catch(error:any) {row.error=error.message;row.stdout=error.stdout?.toString();row.stderr=error.stderr?.toString();save();throw error} finally {await launch.dispose()}
    }
    proof.complete=true;save();console.log(JSON.stringify({complete:true,root,cases:proof.cases.map((v:any)=>({id:v.id,java:v.java,complete:v.complete}))}))
  } finally { await dispatcher?.close(); save() }
}
main().catch(error=>{console.error(error.stderr?.toString() || error.message);process.exitCode=1})
