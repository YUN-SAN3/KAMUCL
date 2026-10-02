/** Lossless Java NBT codec: tag widths, signed longs and homogeneous list types are retained. */
import zlib from 'node:zlib'
export type NbtType = 0|1|2|3|4|5|6|7|8|9|10|11|12
export interface NbtTag { type:NbtType; value:any; elementType?:NbtType }
export type NbtCompound = Record<string,NbtTag>
export const tag=(type:NbtType,value:any,elementType?:NbtType):NbtTag=>({type,value,...(elementType===undefined?{}:{elementType})})
const LIMIT=128*1024*1024
// Java DataInput.readUTF / DataOutput.writeUTF use Modified UTF-8, including surrogate pairs.
export function decodeNbtString(bytes:Buffer):string {
  const chars:number[]=[]
  for(let p=0;p<bytes.length;){const a=bytes[p++];if(a<0x80){chars.push(a);continue}
    if((a&0xe0)===0xc0){const b=bytes[p++];if(b===undefined||(b&0xc0)!==0x80)throw Error('NBT UTF 字符串损坏');const n=((a&31)<<6)|(b&63);if(n!==0&&n<128)throw Error('NBT UTF 字符串损坏');chars.push(n)}
    else if((a&0xf0)===0xe0){const b=bytes[p++],c=bytes[p++];if(b===undefined||c===undefined||(b&0xc0)!==0x80||(c&0xc0)!==0x80)throw Error('NBT UTF 字符串损坏');const n=((a&15)<<12)|((b&63)<<6)|(c&63);if(n<2048)throw Error('NBT UTF 字符串损坏');chars.push(n)}
    else throw Error('NBT Modified UTF-8 编码无效')
  }
  let result='';for(let i=0;i<chars.length;i+=4096)result+=String.fromCharCode(...chars.slice(i,i+4096));return result
}
export function encodeNbtString(value:string):Buffer {const bytes:number[]=[];for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>0&&c<128)bytes.push(c);else if(c<2048)bytes.push(0xc0|(c>>>6),0x80|(c&63));else bytes.push(0xe0|(c>>>12),0x80|((c>>>6)&63),0x80|(c&63))}return Buffer.from(bytes)}
export function readTypedNbt(input:Buffer):{name:string;root:NbtTag}{
  const b=input[0]===0x1f&&input[1]===0x8b?zlib.gunzipSync(input,{maxOutputLength:LIMIT}):input[0]===0x78?zlib.inflateSync(input,{maxOutputLength:LIMIT}):input
  if(b.length>LIMIT)throw new Error('NBT 解压后超过 128 MB')
  let p=0,nodes=0
  function take(n:number){if(!Number.isSafeInteger(n)||n<0||p+n>b.length)throw new Error('NBT 数据截断');const start=p;p+=n;return start}
  const string=()=>{const n=b.readUInt16BE(take(2));return decodeNbtString(b.subarray(take(n),p))}
  const count=()=>{const n=b.readInt32BE(take(4));if(n<0||n>16777216)throw new Error('NBT 集合长度超限');return n}
  function read(type:NbtType,depth:number):NbtTag{
    if(depth>64||++nodes>2000000)throw new Error('NBT 结构过深或标签过多')
    switch(type){
      case 1:return tag(type,b.readInt8(take(1)))
      case 2:return tag(type,b.readInt16BE(take(2)))
      case 3:return tag(type,b.readInt32BE(take(4)))
      case 4:return tag(type,b.readBigInt64BE(take(8)))
      case 5:return tag(type,b.readFloatBE(take(4)))
      case 6:return tag(type,b.readDoubleBE(take(8)))
      case 7:{const n=count();return tag(type,Buffer.from(b.subarray(take(n),p)))}
      case 8:return tag(type,string())
      case 9:{const element=b.readUInt8(take(1)) as NbtType,n=count();if(element>12||(element===0&&n))throw new Error('NBT 列表类型无效');return tag(type,Array.from({length:n},()=>read(element,depth+1)),element)}
      case 10:{const value:NbtCompound=Object.create(null);for(;;){const child=b.readUInt8(take(1)) as NbtType;if(child===0)break;const name=string();if(Object.hasOwn(value,name))throw new Error('NBT 标签重复');value[name]=read(child,depth+1)}return tag(type,value)}
      case 11:{const n=count();return tag(type,Array.from({length:n},()=>b.readInt32BE(take(4))))}
      case 12:{const n=count();return tag(type,Array.from({length:n},()=>b.readBigInt64BE(take(8))))}
      default:throw new Error('NBT 标签类型无效：'+type)
    }
  }
  const type=b.readUInt8(take(1)) as NbtType;if(type!==10)throw new Error('投影 NBT 根必须是 Compound');const name=string(),root=read(type,0);if(p!==b.length)throw new Error('NBT 存在额外尾数据');return {name,root}
}
export function writeTypedNbt(root:NbtTag,name='',compressed=true):Buffer{
  const chunks:Buffer[]=[];let bytes=0,nodes=0
  const push=(b:Buffer)=>{bytes+=b.length;if(bytes>LIMIT)throw new Error('NBT 写入超过 128 MB');chunks.push(b)}
  function number(value:number|bigint,size:number,method:string){const b=Buffer.alloc(size);(b as any)[method](value);push(b)}
  function string(s:string){const b=encodeNbtString(s);if(b.length>65535)throw new Error('NBT 字符串过长');number(b.length,2,'writeUInt16BE');push(b)}
  function write(t:NbtTag,depth:number){if(depth>64||++nodes>2000000)throw new Error('NBT 结构过深或标签过多');switch(t.type){
    case 1:number(t.value,1,'writeInt8');break;case 2:number(t.value,2,'writeInt16BE');break;case 3:number(t.value,4,'writeInt32BE');break;case 4:number(BigInt(t.value),8,'writeBigInt64BE');break;case 5:number(t.value,4,'writeFloatBE');break;case 6:number(t.value,8,'writeDoubleBE');break
    case 7:number(t.value.length,4,'writeInt32BE');push(Buffer.from(t.value));break
    case 8:string(t.value);break
    case 9:{const element=t.elementType??t.value[0]?.type??0;number(element,1,'writeUInt8');number(t.value.length,4,'writeInt32BE');for(const v of t.value){if(v.type!==element)throw new Error('NBT 列表不是同类型');write(v,depth+1)}break}
    case 10:for(const [key,value] of Object.entries(t.value) as [string,NbtTag][]){number(value.type,1,'writeUInt8');string(key);write(value,depth+1)}number(0,1,'writeUInt8');break
    case 11:number(t.value.length,4,'writeInt32BE');for(const v of t.value)number(v,4,'writeInt32BE');break
    case 12:number(t.value.length,4,'writeInt32BE');for(const v of t.value)number(BigInt.asIntN(64,BigInt(v)),8,'writeBigInt64BE');break
    default:throw new Error('NBT 标签类型无效')
  }}
  if(root.type!==10)throw new Error('NBT 根必须是 Compound');number(10,1,'writeUInt8');string(name);write(root,0);const b=Buffer.concat(chunks);return compressed?zlib.gzipSync(b):b
}
