// Entirely synthetic byte/protocol fixtures. No desktop, display or native qualification is claimed.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib')
const {verifyOriginalRecording}=require('../scripts/platform-original-frames.cjs')
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),clone=value=>structuredClone(value)
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function png(raw,width,height){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const scan=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)raw.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4)
 const chunk=(type,data)=>{const tag=Buffer.from(type),bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);tag.copy(bytes,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(Buffer.concat([tag,data])),data.length+8);return bytes}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))])}
function fixture(projection=false){
 const bounds={x:0,y:0,width:960,height:620},display={x:0,y:0,width:1920,height:1080},crop={x:50,y:70,width:8,height:8}
 const identity={ownerPID:123,windowID:77,displayID:2,windowBounds:bounds,displayBounds:display,globalCrop:crop,sourceRect:crop,outputWidth:8,outputHeight:8,backingScaleFactor:1,pixelFormat:'BGRA8',capturePurpose:'skin-walk',minimumFrameInterval:{numeric:true,seconds:0},queueDepth:5}
 const native={ownerPID:123,bounds,contentBounds:bounds,zoom:1,visible:true,focused:true,minimized:false,appHidden:false,activeDisplay:{id:2,bounds:display,scaleFactor:1}}
 const view={focus:true,hidden:false,viewport:{width:960,height:620,scale:1},bounds:{...crop,hitVisible:true,contextWebGL:{lost:false}},pose:{state:'walk'}}
 const proof={platformId:'mac-arm64',attached:new Map(),payload:{recordingType:'ScreenCaptureKit-original-BGRA8',recordingAttachment:'capture',captureIdentityAttachment:'identity',captureRequestAttachment:'request',nativeGeometryAttachment:'geometry',nativeWindowBefore:clone(native),nativeWindowAfter:clone(native),nativeViewBefore:clone(view),nativeViewAfter:clone(view),motionROI:{x:0,y:0,width:8,height:8},interpolated:false,frames:[]}}
 const add=(id,role,bytes,file=id)=>{if(!Buffer.isBuffer(bytes))bytes=Buffer.from(JSON.stringify(bytes));proof.attached.set(id,{id,role,path:'evidence/'+file,bytes,sha256:sha(bytes)});return proof.attached.get(id)}
 const record={complete:true,streamStarted:true,streamStopped:true,error:null,dropCountKnown:false,dropCount:null,identity,frames:[]}
 for(let i=0;i<40;i++){const time={numeric:true,valid:true,value:String(i*1000),timescale:40000,flags:1,epoch:'0',seconds:i*.025},frame={index:i,callbackClock:{machAbsoluteTime:String(100000+i),machTimebaseNumer:1,machTimebaseDenom:1,caCurrentMediaTime:100+i*.025,wallEpochSeconds:1791000000+i*.025,hostTime:clone(time)},duration:{numeric:false,valid:false,value:'0',timescale:0,flags:0,epoch:'0'},complete:i!==7&&i!==11,validSample:i!==11,status:i===7?'idle':i===11?'blank':'complete',statusRaw:i===7?1:i===11?2:0,presentationTime:time}
  const row={index:i,sidecarAttachment:'side-'+i,presentationTime:clone(frame.presentationTime)}
  if(i!==11){const raw=Buffer.alloc(8*8*4);for(let pixel=0;pixel<64;pixel++){raw[pixel*4]=30;raw[pixel*4+1]=20;raw[pixel*4+2]=i%2?160:30;raw[pixel*4+3]=255}const file='frame-'+String(i).padStart(6,'0')+'.bgra';Object.assign(frame,{file,width:8,height:8,sourceBytesPerRow:64,packedBytesPerRow:32,bytes:256,sha256:sha(raw)});row.attachment='raw-'+i;add(row.attachment,'original-bgra-frame',raw,file)}
  record.frames.push(frame);proof.payload.frames.push(row)
 }
 const request={ownerPID:123,displayID:2,windowBounds:bounds,crop,expectedDisplayBounds:display,expectedScale:1,capturePurpose:'skin-walk'}
 function refresh(){add('capture','original-frame-manifest',record,'capture.json');add('identity','original-capture-identity',record.identity,'identity.json');add('request','original-capture-request',request,'request.json');add('geometry','original-native-ui-observations',{nativeBefore:proof.payload.nativeWindowBefore,nativeAfter:proof.payload.nativeWindowAfter,viewBefore:proof.payload.nativeViewBefore,viewAfter:proof.payload.nativeViewAfter},'geometry.json');for(const frame of record.frames){const row=proof.payload.frames[frame.index];row.presentationTime=clone(frame.presentationTime);add(row.sidecarAttachment,'original-frame-sidecar',frame,'frame-'+String(frame.index).padStart(6,'0')+'.json')}}
 refresh()
 if(projection){proof.payload.pngProjectionAttachment='projection';const projected={derived:true,originalManifest:'capture.json',originalManifestSHA256:proof.attached.get('capture').sha256,frames:[]}
  for(const frame of record.frames.filter(value=>value.file)){const rgba=Buffer.from(proof.attached.get('raw-'+frame.index).bytes);for(let p=0;p<rgba.length;p+=4){const blue=rgba[p];rgba[p]=rgba[p+2];rgba[p+2]=blue}const file=frame.file.replace('.bgra','.png'),a=add('png-'+frame.index,'derived-png-frame',png(rgba,8,8),file);projected.frames.push({index:frame.index,file,sha256:a.sha256,original:frame.file,originalSHA256:frame.sha256,originalSidecarSHA256:proof.attached.get('side-'+frame.index).sha256,losslessPixelsVerified:true,presentationTime:clone(frame.presentationTime),timestamp:frame.presentationTime.seconds,complete:frame.complete,validSample:frame.validSample})}
  add('projection','derived-png-projection',projected,'png-projection.json')
 }
 return{proof,record,request,refresh,add,verify:()=>verifyOriginalRecording(proof)}
}
test('synthetic SCK original BGRA keeps every callback and counts only complete valid original PTS pixels',()=>{const f=fixture(),result=f.verify();assert.equal(result.allCallbacks,40);assert.equal(result.frames,38);assert.equal(result.minimum,30);assert(Math.abs(result.fps-37/.975)<1e-12);assert.equal(result.maximumChangedFraction,1)})
test('synthetic lossless PNG projections are derived and reverse-verified against all original BGRA pixels',()=>{assert.equal(fixture(true).verify().allCallbacks,40)})
const negative=(name,change,pattern)=>test(name,()=>{const f=fixture();change(f);assert.throws(f.verify,pattern)})
negative('callback omissions cannot become a complete SCK sample',f=>{f.proof.payload.frames.pop()},/全部callback/)
negative('original frame sidecar status cannot diverge from its callback',f=>{const a=f.proof.attached.get('side-7'),v=JSON.parse(a.bytes);v.status='complete';f.add(a.id,a.role,v,'frame-000007.json')},/callback sidecar/)
negative('changed original byte hashes are rejected',f=>{f.proof.attached.get('raw-0').bytes[0]=99},/Expected values/)
negative('impossible original source stride is rejected',f=>{f.record.frames[0].sourceBytesPerRow=31;f.refresh()},/sourceBytesPerRow/)
negative('changed complete frame PTS cannot be sorted into a pass',f=>{const t=f.record.frames[20].presentationTime;t.value='18000';t.seconds=.45;f.refresh()},/原始时间不递增/)
negative('raw low SCK delivery stays below fixed30 even on a20Hz display',f=>{for(const frame of f.record.frames){frame.presentationTime.timescale=20000;frame.presentationTime.seconds=frame.index*.05}f.proof.payload.nativeWindowBefore.activeDisplay.displayFrequency=20;f.refresh()},/低于固定门槛30/)
negative('many idle callbacks cannot replace ten complete pixel samples',f=>{for(const frame of f.record.frames.slice(8)){frame.complete=false;frame.status='idle';frame.statusRaw=1}f.refresh()},/不足10/)
negative('failed original stream cannot be relabelled accepted',f=>{f.record.complete=false;f.refresh()},/原始采集失败/)
negative('changing ROI cannot hide static model pixels',f=>{f.proof.payload.motionROI.width=4},/完整固定捕获ROI/)
negative('window ownership must match original request',f=>{f.proof.payload.nativeWindowAfter.ownerPID=456;f.refresh()},/Expected values/)
negative('window geometry cannot move during the original capture',f=>{f.proof.payload.nativeWindowAfter.bounds.x=1;f.refresh()},/Expected values/)
test('synthetic derived PNG declarations cannot replace actual byte reverse checking',()=>{const f=fixture(true),a=f.proof.attached.get('png-1');const pixels=Buffer.alloc(256,255),replacement=png(pixels,8,8);f.add(a.id,a.role,replacement,'frame-000001.png');const projection=JSON.parse(f.proof.attached.get('projection').bytes);projection.frames.find(row=>row.index===1).sha256=sha(replacement);f.add('projection','derived-png-projection',projection,'png-projection.json');assert.throws(f.verify,/反核像素不符/)})
test('synthetic SCK success preserves an original reversed CDP sample as failed diagnostic',()=>{const f=fixture(),frames=[0,.02,.019,.04,.06,.08,.10,.12,.14,.16].map(timestamp=>({timestamp}));f.add('cdp','original-cdp-frame-manifest',{source:'Page.startScreencast',frames},'cdp.json');f.proof.payload.cdpDiagnostics=[{manifestAttachment:'cdp',timingUsable:false,status:'failed',rawCalculatedFPS:9/.16,formalCadenceSource:false}];assert.equal(f.verify().frames,38);f.proof.payload.cdpDiagnostics[0].status='passed';assert.throws(f.verify,/原CDP失败不能重标/)})
negative('an idle original status cannot masquerade as complete cadence',f=>{f.record.frames[0].status='idle';f.record.frames[0].statusRaw=1;f.refresh()},/SCFrameStatus与complete/)
negative('known original raw statuses must preserve all six enum meanings',f=>{f.record.frames[7].status='blank';f.refresh()},/六状态映射/)
negative('unknown original status cannot become a complete frame',f=>{f.record.frames[0].status='unknown';f.record.frames[0].statusRaw=null;f.refresh()},/SCFrameStatus与complete/)
negative('even an incomplete callback must retain its original PTS fields',f=>{delete f.record.frames[7].presentationTime;f.refresh()},/全部callback必须保留原CMTime/)
negative('negative original CMTime flags cannot establish native cadence',f=>{f.record.frames[0].presentationTime.flags=-9;f.refresh()},/原CMTime字段/)
negative('changing CMTime epoch cannot establish continuous native cadence',f=>{f.record.frames[1].presentationTime.epoch='1';f.refresh()},/PTS epoch不能变化/)
negative('capture purpose cannot differ from the unchanged original request',f=>{f.request.capturePurpose='logo';f.refresh()},/原采集用途不一致/)
negative('expected native display bounds cannot differ from the actual captured display',f=>{f.request.expectedDisplayBounds={x:0,y:0,width:1280,height:720};f.refresh()},/原显示器边界不一致/)
negative('the original whole-model view must compute the same unchanged capture crop',f=>{f.proof.payload.nativeViewBefore.bounds.x=51;f.refresh()},/原ROI必须覆盖实际/)
test('synthetic invalid-time and unknown-status callbacks remain in their original order without counting them',()=>{const f=fixture();f.record.frames[11].status='unknown';f.record.frames[11].statusRaw=null;f.record.frames[11].presentationTime={value:'0',timescale:0,flags:0,epoch:'0',valid:false,numeric:false};f.refresh();const result=f.verify();assert.equal(result.allCallbacks,40);assert.equal(result.frames,38)})
