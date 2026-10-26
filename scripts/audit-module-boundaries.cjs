// Static dependency evidence. Type imports are recorded separately from runtime
// edges; this report is not a claim that every call graph or UI flow was tested.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),ts=require('typescript'),{parse}=require('@vue/compiler-sfc')
const baseline=process.argv[2]||'HEAD',destination=path.resolve(process.argv[3]||'out/module-audit.json')
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true}).trim()
function snapshot(ref,inventory){
 const files=(inventory||git(['ls-tree','-r','--name-only',ref,'--','src']).split('\n')).filter(f=>/\.(?:ts|vue)$/.test(f)),set=new Set(files),modules={}
 function resolve(from,spec){let base;if(spec.startsWith('.'))base=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));else if(spec.startsWith('@shared/'))base='src/shared/'+spec.slice(8);else return null;return[base,base+'.ts',base+'.vue',base+'/index.ts'].find(f=>set.has(f))||null}
 for(const file of files){
  const raw=ref==='WORKTREE'?fs.readFileSync(file,'utf8'):git(['show',ref+':'+file]),source=file.endsWith('.vue')?(()=>{const d=parse(raw,{filename:file}).descriptor;return[d.script?.content,d.scriptSetup?.content].filter(Boolean).join('\n')})():raw
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),runtime=new Set(),types=new Set()
  function add(value,type){const target=resolve(file,value);if(target)(type?types:runtime).add(target)}
  function walk(node){
   if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){const c=node.importClause,n=c?.namedBindings;const type=!!c?.isTypeOnly||!c?.name&&n&&ts.isNamedImports(n)&&n.elements.length>0&&n.elements.every(e=>e.isTypeOnly);add(node.moduleSpecifier.text,type)}
   if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text,node.isTypeOnly)
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text,false)
   ts.forEachChild(node,walk)
  }walk(ast);modules[file]={lines:raw.split('\n').length,runtime:[...runtime].sort(),types:[...types].sort()}
 }
 const seen=new Set(),active=new Set(),stack=[],index=new Map(),low=new Map(),cycles=[];let sequence=0
 function visit(file){seen.add(file);active.add(file);index.set(file,sequence);low.set(file,sequence++);stack.push(file);for(const next of modules[file].runtime){if(!seen.has(next)){visit(next);low.set(file,Math.min(low.get(file),low.get(next)))}else if(active.has(next))low.set(file,Math.min(low.get(file),index.get(next)))}if(low.get(file)===index.get(file)){const component=[];let member;do{member=stack.pop();active.delete(member);component.push(member)}while(member!==file);if(component.length>1)cycles.push(component.sort())}}
 for(const file of files)if(!seen.has(file))visit(file)
 const violations=files.flatMap(file=>modules[file].runtime.filter(target=>file.startsWith('src/renderer/')&&target.startsWith('src/main/')||file.startsWith('src/shared/')&&!target.startsWith('src/shared/')).map(target=>({from:file,to:target})))
 return{ref,moduleCount:files.length,runtimeEdgeCount:Object.values(modules).reduce((n,m)=>n+m.runtime.length,0),typeEdgeCount:Object.values(modules).reduce((n,m)=>n+m.types.length,0),cycles,violations,modules}
}
// Include new untracked source modules in the working snapshot without staging.
const tracked=snapshot(baseline),all=git(['ls-files','--cached','--others','--exclude-standard','--','src']).split('\n')
const current=snapshot('WORKTREE',all)
const report={baseline:tracked,current,newRuntimeCycles:current.cycles.filter(c=>!tracked.cycles.some(old=>c.every(member=>old.includes(member)))),classification:'Static import graph, including dynamic imports; type-only edges excluded. A smaller strongly connected component contained in a baseline component is a remaining legacy cycle, not an introduced cycle.',createdAt:new Date().toISOString()}
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(report,null,2));console.log(JSON.stringify({destination,baseline:baseline,modules:current.moduleCount,runtimeEdges:current.runtimeEdgeCount,typeEdges:current.typeEdgeCount,newRuntimeCycles:report.newRuntimeCycles,violations:current.violations}));if(current.violations.length)process.exitCode=1
