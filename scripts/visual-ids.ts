import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as baseParse } from '@vue/compiler-dom'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
/** Structural IDs survive text/style edits; every native component can be independently selected. */
export function visualIds() {
 return {name:'kamucl-visual-ids',enforce:'pre' as const,transform(code:string,id:string){
  if(!id.endsWith('.vue') || /(?:EditPanel|VisualEditor)\.vue$/.test(id))return
  const block=parseSfc(code).descriptor.template;if(!block)return
  const edits:{at:number;text:string}[]=[]
  function visit(node:any, trail:string){
   const counts=new Map<string,number>()
   for(const child of node.children||[]){if(child.type!==1)continue
    const cls=child.props?.find((p:any)=>p.type===6&&p.name==='class')?.value?.content || ''
    const signature=child.tag+'.'+cls.split(/\s+/).slice(0,2).join('.'),n=counts.get(signature)||0;counts.set(signature,n+1)
    const route=trail+'/'+signature+'~'+n
    if(child.tagType===0&&child.ns===0&&!['template','script','style','option'].includes(child.tag)&&!child.props.some((p:any)=>p.name==='data-ui')){
     const key=basename(id,'.vue')+':'+createHash('sha1').update(route).digest('hex').slice(0,12)
     edits.push({at:block!.loc.start.offset+child.loc.start.offset+1+child.tag.length,text:' data-ui="'+key+'"'})
    }
    visit(child,route)
   }
  }
  visit(baseParse(block.content),'');for(const edit of edits.reverse())code=code.slice(0,edit.at)+edit.text+code.slice(edit.at)
  return {code,map:null}
 }}
}
