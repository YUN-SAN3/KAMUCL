// Encode real compositor frames with their original timing; never interpolate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
const directory=path.resolve(process.argv[2]),ffmpeg=path.resolve(process.argv[3]),file=path.join(directory,'recording.json'),proof=JSON.parse(fs.readFileSync(file))
assert(proof.frames.length>1&&proof.frames.every(f=>/^frame-\d{4}\.jpg$/.test(f.file)))
// Concurrent screenshot requests can deliver a slightly older compositor frame
// after a newer one. Present actual frames by their recorded timestamp, and
// retain one real image for an identical timestamp instead of inventing time.
const frames=[...new Map([...proof.frames].sort((a,b)=>a.timestamp-b.timestamp).map(frame=>[frame.timestamp,frame])).values()]
const lines=['ffconcat version 1.0']
for(let i=0;i<frames.length;i++){
 const frame=frames[i],next=frames[i+1],duration=next?next.timestamp-frame.timestamp:1/proof.fps
 assert(duration>0&&duration<1,'capture timing must be continuous')
 assert(fs.existsSync(path.join(directory,frame.file)))
 // image2 otherwise defaults to a 25Hz time base and silently drops captured
 // frames on VFR output. A millisecond demuxer clock keeps original intervals.
 lines.push("file '"+frame.file+"'",'option framerate 1000','duration '+duration.toFixed(6))
}
fs.writeFileSync(path.join(directory,'frames.ffconcat'),lines.join('\n')+'\n')
const output=path.join(directory,'recording.mp4')
execFileSync(ffmpeg,['-y','-f','concat','-safe','0','-i','frames.ffconcat','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-fps_mode','vfr','-enc_time_base','1:1000','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-an','recording.mp4'],{cwd:directory,stdio:'pipe'})
// Verify the decoder's terminal frame count from stderr.
const check=require('node:child_process').spawnSync(ffmpeg,['-i','recording.mp4','-f','null','-'],{cwd:directory,encoding:'utf8'});assert.equal(check.status,0,'encoded recording must decode');const counts=[...check.stderr.matchAll(/frame=\s*(\d+)/g)],encodedFrames=Number(counts.at(-1)?.[1]);assert.equal(encodedFrames,frames.length,'every unique original compositor frame must remain in the encoded video')
proof.video={file:'recording.mp4',sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),encodedFrames,timebase:'1ms; original compositor intervals rounded to milliseconds',frameOrder:frames.map(frame=>frame.file),source:'all unique original captured JPEG frames ordered by recorded compositor timestamp, variable frame timing, no interpolation or generated frames',audio:'separate actual mixer recording; this video has no audio'}
fs.writeFileSync(file,JSON.stringify(proof,null,2));console.log(JSON.stringify({output,fps:proof.fps,frames:proof.frames.length,sha256:proof.video.sha256}))
