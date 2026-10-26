// Original Java8-compatible local appearance provider; no compile dependencies.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),project=path.join(root,'offline-skin-agent'),classes=path.join(project,'build/classes'),output=path.join(project,'dist/kamucl-offline-skin.jar')
const tool=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name
if(!classes.startsWith(project+path.sep))throw new Error('Invalid agent build output')
fs.rmSync(classes,{recursive:true,force:true});fs.mkdirSync(classes,{recursive:true});fs.mkdirSync(path.dirname(output),{recursive:true})
execFileSync(tool('javac'),['-encoding','UTF-8','--release','8','-d',classes,path.join(project,'src/cn/kamucl/skin/OfflineSkinAgent.java')],{stdio:'inherit',windowsHide:true})
const manifest=path.join(project,'build/MANIFEST.MF')
fs.writeFileSync(manifest,'Manifest-Version: 1.0\nPremain-Class: cn.kamucl.skin.OfflineSkinAgent\nCan-Redefine-Classes: false\nCan-Retransform-Classes: false\n\n')
execFileSync(tool('jar'),['cfm',output,manifest,'-C',classes,'.'],{stdio:'inherit',windowsHide:true})
console.log('Built local skin provider: '+output)
