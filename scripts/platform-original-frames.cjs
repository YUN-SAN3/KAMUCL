// Read original capture bytes only. No interpolation, sorting, cropping or timestamp rewriting.
const assert=require('node:assert/strict'),path=require('node:path'),zlib=require('node:zlib'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto')
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function crc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function decodePNG(bytes){
 assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'派生图必须为无损PNG')
 let header,ended=false,at=8;const chunks=[]
 while(at<=bytes.length-12){const length=bytes.readUInt32BE(at),tag=bytes.toString('ascii',at+4,at+8);assert(length<=bytes.length-at-12,'PNG截断');const data=bytes.subarray(at+8,at+8+length);assert.equal(crc32(bytes.subarray(at+4,at+8+length)),bytes.readUInt32BE(at+8+length),'PNG CRC错误');if(tag==='IHDR'){assert(!header);header=data}else if(tag==='IDAT')chunks.push(data);else if(tag==='IEND'){assert.equal(length,0);assert.equal(at+12,bytes.length);ended=true;break}at+=length+12}
 assert(header?.length===13&&ended&&chunks.length,'PNG结构不完整');const width=header.readUInt32BE(0),height=header.readUInt32BE(4),channels=header[9]===6?4:header[9]===2?3:0
 assert(width>0&&height>0&&width<=16384&&height<=16384&&width*height<=16*1024*1024,'PNG像素尺寸无效');assert(header[8]===8&&channels&&header[10]===0&&header[11]===0&&header[12]===0,'必须为8位RGB/RGBA非交错原像素PNG')
 const stride=width*channels,decoded=zlib.inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});assert.equal(decoded.length,(stride+1)*height)
 const raw=Buffer.alloc(stride*height),rgba=Buffer.alloc(width*height*4),paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c}
 for(let y=0;y<height;y++){const filter=decoded[y*(stride+1)];assert(filter<=4,'PNG过滤器无效');for(let x=0;x<stride;x++){const at=y*stride+x,left=x>=channels?raw[at-channels]:0,up=y?raw[at-stride]:0,corner=y&&x>=channels?raw[at-stride-channels]:0;const extra=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];raw[at]=(decoded[y*(stride+1)+x+1]+extra)&255}}
 for(let pixel=0;pixel<width*height;pixel++){raw.copy(rgba,pixel*4,pixel*channels,pixel*channels+3);rgba[pixel*4+3]=channels===4?raw[pixel*4+3]:255}return{width,height,rgba}
}
function decodeImage(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return decodePNG(bytes)
 // Sharp is a pinned existing dependency. A bounded private decoder process keeps
 // the release gate synchronous; it cannot generate or alter an acceptance frame.
 const code="const parts=[];process.stdin.on('data',b=>parts.push(b));process.stdin.on('end',async()=>{try{const sharp=require(process.argv[1]);const {data,info}=await sharp(Buffer.concat(parts),{limitInputPixels:16777216}).ensureAlpha().raw().toBuffer({resolveWithObject:true});const h=Buffer.alloc(8);h.writeUInt32LE(info.width);h.writeUInt32LE(info.height,4);process.stdout.write(Buffer.concat([h,data]))}catch(e){console.error(e.message);process.exitCode=1}})"
 const raw=execFileSync(process.execPath,['-e',code,require.resolve('sharp')],{input:bytes,timeout:15000,maxBuffer:70*1024*1024,windowsHide:true}),width=raw.readUInt32LE(0),height=raw.readUInt32LE(4)
 assert.equal(raw.length,8+width*height*4);return{width,height,rgba:raw.subarray(8)}
}
const attachmentJSON=(proof,id,role)=>{const a=proof.attached.get(id);assert(a?.role===role,'缺少原始附件：'+role);return{attachment:a,document:JSON.parse(a.bytes.toString('utf8'))}}
function originalTime(time,requireNumeric=false){
 assert(time&&/^-?\d+$/.test(time.value)&&/^-?\d+$/.test(time.epoch)&&Number.isSafeInteger(time.timescale)&&time.timescale>=-2147483648&&time.timescale<=2147483647&&Number.isSafeInteger(time.flags)&&time.flags>=0&&time.flags<=4294967295&&typeof time.valid==='boolean'&&typeof time.numeric==='boolean','全部callback必须保留原CMTime字段')
 for(const key of['value','epoch']){const n=BigInt(time[key]);assert(n>=-(1n<<63n)&&n<(1n<<63n),'原CMTime整数越界')}
 assert.equal(time.valid,(time.flags&1)!==0,'CMTime valid与原flags不符')
 if(time.flags<=31)assert.equal(time.numeric,time.valid&&(time.flags&28)===0,'CMTime numeric与原flags不符')
 if(requireNumeric){assert(time.valid&&time.numeric&&(time.flags===1||time.flags===3),'计数PTS必须为实际有效numeric flags')}
 if(time.numeric){assert(time.timescale>0&&Number.isFinite(time.seconds));assert(Math.abs(Number(BigInt(time.value))/time.timescale-time.seconds)<=Math.max(1,Math.abs(time.seconds))*1e-12,'原PTS数值与timescale不一致')}
 else if(Object.hasOwn(time,'seconds'))assert(Number.isFinite(time.seconds),'原CMTime不能补造非有限秒数')
}
function rect(value){assert(value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))&&value.width>0&&value.height>0,'原始可见几何无效');return value}
function contains(outer,inner){rect(outer);rect(inner);return inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height}
function changeFraction(reference,current,roi){let changed=0;for(let y=roi.y;y<roi.y+roi.height;y++)for(let x=roi.x;x<roi.x+roi.width;x++){const at=(y*reference.width+x)*4;if(Math.max(...[0,1,2].map(channel=>Math.abs(reference.rgba[at+channel]-current.rgba[at+channel])))>12)changed++}return changed/(roi.width*roi.height)}
function statistics(samples,roi,allCallbacks){
 assert(samples.length>=10,'完整原像素帧不足10');const stamps=samples.map(value=>value.timestamp);assert(stamps.every((value,index)=>Number.isFinite(value)&&(index===0||value>stamps[index-1])),'原始时间不递增，禁止重排或修正')
 const elapsed=stamps.at(-1)-stamps[0],fps=(stamps.length-1)/elapsed;assert(elapsed>=.7,'动作录制时间不足');assert(fps>=30,'原始采集低于固定门槛30FPS')
 const reference=samples[0];assert(roi&&Object.values(roi).every(Number.isSafeInteger)&&roi.x>=0&&roi.y>=0&&roi.width>0&&roi.height>0&&roi.x+roi.width<=reference.width&&roi.y+roi.height<=reference.height,'固定运动ROI无效')
 let maximumChangedFraction=0;const seen=new Set();for(const current of samples){assert.equal(current.width,reference.width);assert.equal(current.height,reference.height);const key=current.sha256??current.rgba;if(seen.has(key))continue;seen.add(key);maximumChangedFraction=Math.max(maximumChangedFraction,changeFraction(reference,current,roi))}
 assert(maximumChangedFraction>.005,'固定原像素ROI没有超过12通道差/0.5%像素变化')
 return{fps,minimum:30,elapsed,frames:samples.length,allCallbacks,maximumChangedFraction,roi}
}
function originalBGRA(proof,record){
 assert.equal(proof.payload.recordingType,'ScreenCaptureKit-original-BGRA8','BGRA必须明确为原始ScreenCaptureKit类型');assert.equal(proof.platformId.startsWith('mac-'),true)
 assert.equal(record.complete,true,'原始采集失败不能重标');assert.equal(record.streamStarted,true);assert.equal(record.streamStopped,true);assert.equal(record.error,null)
 assert.equal(record.dropCountKnown,false);assert.equal(record.dropCount,null,'未知丢帧不能声明零丢帧')
 const identity=record.identity,{document:request}=attachmentJSON(proof,proof.payload.captureRequestAttachment,'original-capture-request'),{document:sideIdentity}=attachmentJSON(proof,proof.payload.captureIdentityAttachment,'original-capture-identity')
 assert.deepEqual(sideIdentity,identity,'原始identity sidecar不符');assert.equal(identity.pixelFormat,'BGRA8');assert(['logo','skin-walk'].includes(identity.capturePurpose));assert(Number.isSafeInteger(identity.ownerPID)&&identity.ownerPID>1&&Number.isSafeInteger(identity.windowID)&&identity.windowID>0&&Number.isSafeInteger(identity.displayID)&&identity.displayID>0)
 assert.equal(identity.minimumFrameInterval?.numeric,true);assert.equal(identity.minimumFrameInterval?.seconds,0);assert.equal(identity.queueDepth,5)
 assert.equal(identity.ownerPID,request.ownerPID);assert.equal(identity.displayID,request.displayID);assert.deepEqual(identity.windowBounds,request.windowBounds);assert.deepEqual(identity.globalCrop,request.crop);assert.equal(identity.backingScaleFactor,request.expectedScale);assert(identity.backingScaleFactor>0)
 assert.equal(identity.capturePurpose,request.capturePurpose??'logo','原采集用途不一致');if(request.expectedDisplayBounds)assert.deepEqual(identity.displayBounds,request.expectedDisplayBounds,'原显示器边界不一致')
 assert(contains(identity.windowBounds,identity.globalCrop)&&contains(identity.displayBounds,identity.globalCrop),'原始ROI必须位于同一可见窗口与显示器')
 assert.deepEqual(identity.sourceRect,{...identity.globalCrop,x:identity.globalCrop.x-identity.displayBounds.x,y:identity.globalCrop.y-identity.displayBounds.y})
 assert.equal(identity.outputWidth,Math.ceil(request.crop.width*request.expectedScale));assert.equal(identity.outputHeight,Math.ceil(request.crop.height*request.expectedScale));assert(identity.outputWidth<=1024&&identity.outputHeight<=1024)
 const {document:geometry}=attachmentJSON(proof,proof.payload.nativeGeometryAttachment,'original-native-ui-observations')
 for(const [ordinal,native] of[proof.payload.nativeWindowBefore,proof.payload.nativeWindowAfter].entries()){
  const view=ordinal?proof.payload.nativeViewAfter:proof.payload.nativeViewBefore;assert.deepEqual(geometry[ordinal?'nativeAfter':'nativeBefore'],native,'窗口观察必须绑定原附件');assert.deepEqual(geometry[ordinal?'viewAfter':'viewBefore'],view,'模型观察必须绑定原附件')
  assert(native?.visible===true&&native.focused===true&&native.minimized===false&&native.appHidden===false,'没有真实前后景窗口观察');assert.equal(native.ownerPID,identity.ownerPID);assert.deepEqual(native.bounds,identity.windowBounds);assert.equal(native.activeDisplay.id,identity.displayID);assert.deepEqual(native.activeDisplay.bounds,identity.displayBounds);assert.equal(native.activeDisplay.scaleFactor,identity.backingScaleFactor)
  // Reuse the actual QA's pure geometry contract, not a second looser crop formula.
  const calculated=identity.capturePurpose==='skin-walk'?require('./verify-mac-skin-walk-capture.cjs').skinCaptureRequest(native,view):require('./verify-kamu-native-video-119.cjs').captureRequest(native,view)
  assert.deepEqual(calculated,request,'原ROI必须覆盖实际同一可见模型几何，禁止任意重选crop')
 }
 assert.deepEqual(proof.payload.motionROI,{x:0,y:0,width:identity.outputWidth,height:identity.outputHeight},'必须保留完整固定捕获ROI')
 assert(Array.isArray(record.frames)&&record.frames.length>=10&&proof.payload.frames.length===record.frames.length,'全部callback不能删减')
 const pixels=new Map(),samples=[];let lastClock=-1n,epoch
 for(let index=0;index<record.frames.length;index++){
  const frame=record.frames[index],row=proof.payload.frames[index];assert.equal(frame.index,index);assert.equal(row.index,index)
  const {attachment:side,document:sidecar}=attachmentJSON(proof,row.sidecarAttachment,'original-frame-sidecar');assert.equal(path.basename(side.path),'frame-'+String(index).padStart(6,'0')+'.json');assert.deepEqual(sidecar,frame,'callback sidecar不能改写')
  const callback=frame.callbackClock;assert(callback&&/^\d+$/.test(callback.machAbsoluteTime)&&Number.isSafeInteger(callback.machTimebaseNumer)&&callback.machTimebaseNumer>0&&Number.isSafeInteger(callback.machTimebaseDenom)&&callback.machTimebaseDenom>0&&Number.isFinite(callback.caCurrentMediaTime)&&Number.isFinite(callback.wallEpochSeconds),'原callback clock字段不完整');originalTime(callback.hostTime)
  const clock=BigInt(callback.machAbsoluteTime);assert(clock>lastClock,'全部callback原顺序不能改写');lastClock=clock
  originalTime(frame.presentationTime);originalTime(frame.duration);assert.deepEqual(row.presentationTime,frame.presentationTime,'原PTS全部字段必须保留');assert.equal(typeof frame.complete,'boolean');assert.equal(typeof frame.validSample,'boolean');assert.equal(typeof frame.status,'string');assert(Object.hasOwn(frame,'statusRaw'))
  const statuses=['complete','idle','blank','suspended','started','stopped'];if(Number.isSafeInteger(frame.statusRaw)&&frame.statusRaw>=0&&frame.statusRaw<statuses.length)assert.equal(frame.status,statuses[frame.statusRaw],'原SCFrameStatus六状态映射不符');else assert(frame.status==='unknown'&&(frame.statusRaw===null||Number.isSafeInteger(frame.statusRaw)),'未知原status必须保留且不能计数')
  assert.equal(frame.complete,frame.status==='complete'&&frame.statusRaw===0,'原SCFrameStatus与complete声明不一致')
  if(!frame.file){assert(!row.attachment,'无像素callback不能合成帧');assert(!frame.complete||!frame.validSample,'完整有效callback缺少原像素');continue}
  const raw=proof.attached.get(row.attachment);assert(raw?.role==='original-bgra-frame'&&path.basename(raw.path)===frame.file,'原始BGRA附件不符');assert.equal(frame.file,'frame-'+String(index).padStart(6,'0')+'.bgra')
  assert.equal(frame.width,identity.outputWidth);assert.equal(frame.height,identity.outputHeight);assert(Number.isSafeInteger(frame.sourceBytesPerRow)&&frame.sourceBytesPerRow>=frame.width*4,'sourceBytesPerRow 无效');assert.equal(frame.packedBytesPerRow,frame.width*4);assert.equal(frame.bytes,frame.width*frame.height*4);assert.equal(raw.bytes.length,frame.bytes);assert.equal(raw.sha256,frame.sha256);assert.equal(sha(raw.bytes),frame.sha256)
  const rgba=Buffer.from(raw.bytes);for(let at=0;at<rgba.length;at+=4){const blue=rgba[at];rgba[at]=rgba[at+2];rgba[at+2]=blue}
  const sample={index,width:frame.width,height:frame.height,rgba,timestamp:frame.presentationTime?.seconds,sha256:frame.sha256};pixels.set(index,sample)
  if(frame.complete&&frame.validSample){const time=frame.presentationTime;originalTime(time,true);epoch??=time.epoch;assert.equal(time.epoch,epoch,'同一原始采集PTS epoch不能变化');samples.push(sample)}
 }
 if(proof.payload.pngProjectionAttachment){
  const {document:projection}=attachmentJSON(proof,proof.payload.pngProjectionAttachment,'derived-png-projection');assert.equal(projection.derived,true);assert.equal(projection.originalManifestSHA256,proof.attached.get(proof.payload.recordingAttachment).sha256);assert.equal(path.basename(proof.attached.get(proof.payload.recordingAttachment).path),projection.originalManifest);assert.equal(projection.frames.length,pixels.size)
  const seen=new Set();for(const projected of projection.frames){assert(!seen.has(projected.index));seen.add(projected.index);const frame=record.frames[projected.index],sample=pixels.get(projected.index);assert(sample);assert.equal(projected.original,frame.file);assert.equal(projected.originalSHA256,frame.sha256);assert.equal(projected.derived??true,true);assert.equal(projected.losslessPixelsVerified,true)
   const png=[...proof.attached.values()].find(value=>value.role==='derived-png-frame'&&path.basename(value.path)===projected.file);assert(png&&png.sha256===projected.sha256,'派生PNG附件缺少或摘要不符');assert.equal(projected.file,frame.file.replace(/\.bgra$/,'.png'));const decoded=decodePNG(png.bytes);assert.equal(decoded.width,sample.width);assert.equal(decoded.height,sample.height);assert(decoded.rgba.equals(sample.rgba),'派生PNG反核像素不符')
   const side=proof.attached.get(proof.payload.frames[projected.index].sidecarAttachment);assert.equal(projected.originalSidecarSHA256,side.sha256);assert.deepEqual(projected.presentationTime,frame.presentationTime);assert.equal(projected.timestamp,frame.presentationTime.seconds??null);assert.equal(projected.complete,frame.complete);assert.equal(projected.validSample,frame.validSample)
  }
 }
 return statistics(samples,proof.payload.motionROI,record.frames.length)
}
function originalImages(proof,record){
 assert(/(?:Page\.(?:startScreencast|screencastFrame)|native-screen-recorder)/.test(record.source||record.classification||''),'不是原生屏幕采集');assert(Array.isArray(record.frames)&&record.frames.length>=10&&proof.payload.frames.length===record.frames.length,'帧清单不完整');const samples=[],cache=new Map()
 for(let index=0;index<record.frames.length;index++){const frame=record.frames[index],row=proof.payload.frames[index],a=proof.attached.get(row.attachment);assert.equal(row.index,index,'原始帧重排');assert(a?.role==='frame'&&path.basename(a.path)===frame.file,'原始帧绑定不符');const timestamp=frame.timestamp;assert.equal(row.timestamp,timestamp,'原始时间被改写');let decoded=cache.get(a.sha256);if(!decoded){decoded=decodeImage(a.bytes);cache.set(a.sha256,decoded)}samples.push({...decoded,timestamp})}
 const roi=record.motionROI??{x:0,y:0,width:samples[0].width,height:samples[0].height};assert.deepEqual(proof.payload.motionROI,roi,'固定ROI不能改写');return statistics(samples,roi,record.frames.length)
}
function preserveCDPDiagnostics(proof){
 const originals=[...proof.attached.values()].filter(row=>row.role==='original-cdp-frame-manifest'),rows=proof.payload.cdpDiagnostics??[]
 assert(Array.isArray(rows)&&rows.length===originals.length&&new Set(rows.map(row=>row.manifestAttachment)).size===rows.length,'已有原CDP诊断不可删除或重复')
 for(const original of originals){const row=rows.find(value=>value.manifestAttachment===original.id);assert(row,'已有原CDP失败不可省略');const record=JSON.parse(original.bytes.toString('utf8'));assert(/Page\.(?:startScreencast|screencastFrame)/.test(record.source||record.classification||''));assert(Array.isArray(record.frames))
  const stamps=record.frames.map(frame=>frame.timestamp),usable=stamps.length>=2&&stamps.every((stamp,index)=>Number.isFinite(stamp)&&(index===0||stamp>stamps[index-1])),elapsed=stamps.length>=2?stamps.at(-1)-stamps[0]:0,fps=elapsed?(stamps.length-1)/elapsed:0,passed=usable&&stamps.length>=10&&fps>=30
  assert.equal(row.timingUsable,usable,'原CDP时序失败不能重标');assert.equal(row.status,passed?'passed':'failed','原CDP失败不能重标');assert.equal(row.rawCalculatedFPS,Number.isFinite(fps)?fps:null,'原CDP原算术FPS不能改写');assert.equal(row.formalCadenceSource,false,'CDP诊断不能替代SCK原呈现门槛')
 }
}
function verifyOriginalRecording(proof){const {document:record}=attachmentJSON(proof,proof.payload.recordingAttachment,'original-frame-manifest');assert.equal(proof.payload.interpolated,false,'禁止插帧');assert(Array.isArray(proof.payload.frames));preserveCDPDiagnostics(proof);if(proof.payload.recordingType==='ScreenCaptureKit-original-BGRA8')return originalBGRA(proof,record)
 for(const key of['version','sourceCommit','platformId','architecture','runtimeVersion'])assert.equal(record[key],proof[key],'原始采集身份不一致：'+key);assert.deepEqual(record.artifactSHA256,proof.artifactSHA256,'原始采集附件身份不一致');return originalImages(proof,record)}
module.exports={verifyOriginalRecording,decodePNG}
