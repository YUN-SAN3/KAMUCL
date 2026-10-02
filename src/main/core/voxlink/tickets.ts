// SPDX-License-Identifier: LGPL-3.0-only
// TicketClient.java / TicketDetailScreen.java, VoxLink c475faa9; KAMUCL controlled IPC adapter.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiClient, APP_VERSION, validateServerURL } from './api'
import type { VoxTicket, VoxTicketDetail, VoxTicketAttachment } from '../../../shared/voxlinkTickets'
import { TICKET_DESCRIPTION_MAX,TICKET_MESSAGE_MAX,TICKET_MESSAGE_COUNT_MAX,TICKET_FILES_MAX,TICKET_BYTES_MAX } from '../../../shared/voxlinkTickets'
export class TicketError extends Error {constructor(readonly code:string,message:string,readonly retryAt?:number){super(message)}}
interface StoredTicket extends VoxTicket { secret:string;server:string }
export interface TicketFile {path:string;name:string;size:number;mtime:number}
export interface SecretCodec {seal:(text:string)=>string;open:(text:string)=>string}
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id)
const safeCount=(n:unknown)=>Math.max(0,Math.trunc(Number(n)||0))
const attach=(raw:any):VoxTicketAttachment[]=>Array.isArray(raw)?raw.slice(0,10).filter(a=>a&&typeof a.name==='string'&&Number.isSafeInteger(a.size)&&a.size>=0).map(a=>({name:a.name.slice(0,255),size:a.size})):[]
export class TicketService {
  private loaded=false;private rows:StoredTicket[]=[];private polled=false
  private coolDown=new Map<string,number>();private history=new Map<string,number[]>();private lastReply=new Map<string,{text:string;at:number}>()
  constructor(private file:string,private base:()=>string,private codec:SecretCodec={seal:text=>text,open:text=>text},private request:typeof fetch=fetch){}
  private load(){if(this.loaded)return;this.loaded=true;try{const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(raw))throw Error('format');this.rows=raw.filter(r=>r&&validId(r.id)&&typeof r.secret==='string'&&validateServerURL(r.server)).map(r=>({...r,timeMs:safeCount(r.timeMs),lastTimeMs:safeCount(r.lastTimeMs),replyCount:safeCount(r.replyCount),deleted:r.deleted===true,hasUnread:r.hasUnread===true}))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'){this.loaded=false;throw new TicketError('STORE_INVALID','本地工单索引无法读取，已保留原文件')}}}
  private save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(this.rows),{mode:0o600});fs.renameSync(temp,this.file)}finally{try{fs.unlinkSync(temp)}catch{}}}
  list():VoxTicket[]{this.load();return this.rows.filter(r=>r.server===this.base()&&!r.deleted).map(({secret,server,...visible})=>visible).sort((a,b)=>(b.lastTimeMs||b.timeMs)-(a.lastTimeMs||a.timeMs))}
  private owned(id:string){this.load();const row=this.rows.find(r=>r.id===id&&r.server===this.base()&&!r.deleted);if(!row)throw new TicketError('UNKNOWN_TICKET','本机没有该工单的归属凭证');return row}
  private secret(row:StoredTicket){try{return this.codec.open(row.secret)}catch{throw new TicketError('SECRET_UNAVAILABLE','工单归属凭证无法解密，请使用最初提交工单的系统账号')}}
  private url(route:string,query?:Record<string,string>){const base=this.base();if(!validateServerURL(base))throw new TicketError('BAD_SERVER_URL','工单服务器地址无效');const url=new URL(base);url.searchParams.set('route',route);for(const[key,value]of Object.entries(query??{}))url.searchParams.set(key,value);return url}
  private async send(route:string,init:RequestInit,signal:AbortSignal,query?:Record<string,string>):Promise<any>{
    try{const response=await this.request(this.url(route,query),{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(init.body&&typeof init.body!=='string'?1800000:15000)]),redirect:'error'})
      const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let total=0
      try{if(reader)for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>4*1024*1024)throw new TicketError('BAD_RESPONSE','工单响应过大');chunks.push(part.value)}}finally{await reader?.cancel().catch(()=>{})}
      let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString())}catch{throw new TicketError('BAD_RESPONSE','工单服务器返回无效数据')}
      if(!response.ok||data.success!==true){const code=typeof data.error==='string'&&/^[A-Z_\d]{1,80}$/.test(data.error)?data.error:'BAD_RESPONSE';const seconds=Number(data.details?.retryAfter);const retryAt=code==='RATE_LIMITED'?Date.now()+(seconds>0&&Number.isFinite(seconds)?Math.min(seconds,86400):600)*1000:undefined;if(retryAt)this.coolDown.set(route,retryAt);throw new TicketError(code,code==='RATE_LIMITED'?'请求过于频繁，请等待倒计时后重试':`工单操作失败 (${code})`,retryAt)}
      return data.data
    }catch(error){if(error instanceof TicketError)throw error;if(signal.aborted)throw new TicketError('CANCELLED','工单请求已取消');throw new TicketError('NETWORK_ERROR','工单网络请求失败，请检查网络后重试')}
  }
  private json(route:string,body:unknown,signal:AbortSignal){return this.send(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},signal)}
  async pollOnce(signal:AbortSignal){if(this.polled)return this.list();this.polled=true;this.load();const rows=this.rows.filter(r=>r.server===this.base()&&!r.deleted)
    for(let offset=0;offset<rows.length;offset+=50){signal.throwIfAborted();const data=await this.json('/ticket/poll',{ids:rows.slice(offset,offset+50).map(r=>r.id)},signal);const selected=new Set(rows.slice(offset,offset+50).map(r=>r.id));for(const item of Array.isArray(data?.tickets)?data.tickets:[]){if(!selected.has(item?.id))continue;const row=this.rows.find(r=>r.id===item.id&&r.server===this.base())!;row.hasUnread=item.hasUnread===true;row.deleted=item.deleted===true;row.replyCount=safeCount(item.replyCount);row.lastTimeMs=safeCount(item.lastTime)*1000}const removed=new Set(Array.isArray(data?.removed)?data.removed.filter((id:unknown)=>selected.has(id as string)):[]);this.rows=this.rows.filter(r=>r.server!==this.base()||!removed.has(r.id));this.save()}
    return this.list()
  }
  async detail(id:string,signal:AbortSignal):Promise<VoxTicketDetail>{const row=this.owned(id),data=await this.send('/ticket/detail',{method:'GET'},signal,{id,secret:this.secret(row)});if(data?.id!==id||typeof data.description!=='string'||!Array.isArray(data.messages)||data.messages.length>TICKET_MESSAGE_COUNT_MAX)throw new TicketError('BAD_RESPONSE','工单详情数据不完整')
    const detail:VoxTicketDetail={id,timeMs:safeCount(data.time)*1000,deleted:data.deleted===true,description:data.description,attachments:attach(data.attachments),messages:data.messages.map((m:any)=>({id:validId(m.id)?m.id:undefined,from:typeof m.from==='string'?m.from:'unknown',timeMs:safeCount(m.time)*1000,text:typeof m.text==='string'?m.text:'',attachments:attach(m.attachments)}))};row.hasUnread=false;row.replyCount=detail.messages.filter(m=>m.from==='admin').length;row.lastTimeMs=Math.max(row.timeMs,...detail.messages.map(m=>m.timeMs));this.save();void this.json('/ticket/viewed',{id,secret:this.secret(row)},new AbortController().signal).catch(()=>{});return detail
  }
  private rate(route:string){const now=Date.now(),until=this.coolDown.get(route)||0,history=(this.history.get(route)||[]).filter(t=>now-t<600000);this.history.set(route,history);if(now<until)throw new TicketError('RATE_LIMITED','请求过于频繁，请稍后重试',until);if(history.length>=3)throw new TicketError('RATE_LIMITED','每 10 分钟最多提交 3 次，请稍后重试',history[0]+600000)}
  private async upload(route:string,fields:Record<string,string>,files:TicketFile[],signal:AbortSignal,onProgress?:(bytes:number,total:number)=>void){
    if(files.length>TICKET_FILES_MAX||files.reduce((sum,f)=>sum+f.size,0)>TICKET_BYTES_MAX)throw new TicketError('TICKET_TOO_LARGE','每条消息最多 10 个附件，附件总量不得超过 500 MB')
    this.rate(route);const boundary='----VoxLinkTK'+randomUUID().replaceAll('-',''),crlf=Buffer.from('\r\n'),parts=Object.entries(fields).map(([key,value])=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${value}\r\n`))
    const heads=files.map(f=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachments"; filename="${f.name.replace(/["\r\n]/g,'_')}"\r\nContent-Type: application/octet-stream\r\n\r\n`)),end=Buffer.from(`--${boundary}--\r\n`)
    const handles:fs.promises.FileHandle[]=[]
    try{for(const file of files){const handle=await fs.promises.open(file.path,'r');handles.push(handle);const stat=await handle.stat();if(!stat.isFile()||stat.size!==file.size||stat.mtimeMs!==file.mtime)throw new TicketError('ATTACHMENT_CHANGED',`${file.name} 已变化，请重新选择`)}
      const total=parts.reduce((n,b)=>n+b.length,0)+heads.reduce((n,b)=>n+b.length,0)+files.reduce((n,f)=>n+f.size+2,0)+end.length
      async function* body(){let bytes=0;const report=(b:Buffer)=>{signal.throwIfAborted();bytes+=b.length;onProgress?.(bytes,total);return b};for(const part of parts)yield report(part);for(let i=0;i<files.length;i++){yield report(heads[i]);let bytesRead=0;for await(const part of handles[i].createReadStream({autoClose:false,highWaterMark:65536})){bytesRead+=part.length;yield report(Buffer.from(part))}if(bytesRead!==files[i].size)throw new TicketError('ATTACHMENT_CHANGED','上传期间附件已变化');yield report(crlf)}yield report(end)}
      const result=await this.send(route,{method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(total)},body:body(),duplex:'half'} as unknown as RequestInit,signal)
      this.history.get(route)!.push(Date.now());return result
    }finally{for(const handle of handles)await handle.close().catch(()=>{})}
  }
  async submit(description:string,files:TicketFile[],signal:AbortSignal,progress?:(n:number,total:number)=>void){
    if(typeof description!=='string'||!description.trim()||description.length>TICKET_DESCRIPTION_MAX)throw new TicketError('INVALID_DESCRIPTION','请填写 1–10000 字的问题描述')
    signal.throwIfAborted();this.load()
    // The server returns the ownership secret only once. Validate both secure storage
    // and the writable local index before sending any user content.
    const probe='ticket-storage-'+randomUUID();if(this.codec.open(this.codec.seal(probe))!==probe)throw new TicketError('SECRET_UNAVAILABLE','系统凭证保护无法验证，请稍后再提交')
    this.save();signal.throwIfAborted()
    const data=await this.upload('/ticket/submit',{description:description.trim(),client:'app',clientInfo:JSON.stringify({client:'KAMUCL',version:APP_VERSION,os:process.platform,arch:process.arch})},files,signal,progress)
    if(!validId(data?.id)||typeof data.ticketSecret!=='string'||!data.ticketSecret)throw new TicketError('BAD_RESPONSE','服务器未返回工单归属凭证')
    const now=Date.now();this.rows.push({id:data.id,secret:this.codec.seal(data.ticketSecret),server:this.base(),timeMs:now,lastTimeMs:now,deleted:false,hasUnread:false,replyCount:0});this.save();return{id:data.id}
  }
  async reply(id:string,text:string,files:TicketFile[],signal:AbortSignal,progress?:(n:number,total:number)=>void){const row=this.owned(id);if(typeof text!=='string'||text.length>TICKET_MESSAGE_MAX||!text.trim()&&!files.length)throw new TicketError('INVALID_MESSAGE','追问最多 2000 字，文字与附件不能都为空');const last=this.lastReply.get(id);if(!files.length&&last?.text===text.trim()&&Date.now()-last.at<15000)throw new TicketError('DUPLICATE','同一段追问请间隔 15 秒再发送');const detail=await this.detail(id,signal);if(detail.messages.length>=TICKET_MESSAGE_COUNT_MAX)throw new TicketError('MESSAGE_LIMIT','工单已达到 200 条消息上限');const used=detail.attachments.concat(detail.messages.flatMap(m=>m.attachments)).reduce((n,f)=>n+f.size,0);if(used+files.reduce((n,f)=>n+f.size,0)>TICKET_BYTES_MAX)throw new TicketError('TICKET_TOO_LARGE','该工单附件总量不得超过 500 MB');await this.upload('/ticket/reply',{id,secret:this.secret(row),text:text.trim()},files,signal,progress);this.lastReply.set(id,{text:text.trim(),at:Date.now()});row.lastTimeMs=Date.now();this.save();return{id}}
  async retract(id:string,msg:string,signal:AbortSignal){const row=this.owned(id),detail=await this.detail(id,signal),last=[...detail.messages].reverse().find(m=>m.from!=='admin'&&m.id);if(!last||last.id!==msg)throw new TicketError('TICKET_FORBIDDEN','只能撤回自己的上一条追问');await this.json('/ticket/retract',{id,msg,secret:this.secret(row)},signal);return{id}}
  async remove(id:string,signal:AbortSignal){const row=this.owned(id);await this.json('/ticket/delete',{id,secret:this.secret(row)},signal);row.deleted=true;row.hasUnread=false;this.save();return{id}}
}
