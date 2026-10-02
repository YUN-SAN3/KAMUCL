// Kamu Minecraft UV reconstructed from the supplied front/back rendered references.
// The six retired textures are retained as historical source assets, never loaded by the logo.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp')
const target=path.resolve(__dirname,'../src/renderer/src/assets/mascot-skins/kamu.png')
const pixels=Buffer.alloc(64*64*4)
const P={W:'#eeeeec',w:'#e1e2df',g:'#cfd2ce',E:'#806b67',P:'#efd1d5',p:'#e7bcc2',B:'#805345',b:'#684137',m:'#512a26',M:'#61332c',T:'#049e9f',t:'#008a8d',C:'#0db4b3',c:'#078085',A:'#ad7c61',a:'#93684f',h:'#bd8b6d',N:'#8a604c',V:'#3b2b87',v:'#302273',L:'#483599',l:'#342779',S:'#565955',s:'#64665f'}
const dot=(x,y,color)=>{const hex=P[color]||color,v=hex.slice(1).match(/../g).map(v=>parseInt(v,16)),i=(y*64+x)*4;pixels.set([...v,255],i)}
function part(u,v,w,h,d,base){const faces={top:[u+d,v,w,d],bottom:[u+d+w,v,w,d],left:[u,v+d,d,h],front:[u+d,v+d,w,h],right:[u+d+w,v+d,d,h],back:[u+d+w+d,v+d,w,h]};for(const [x,y,fw,fh] of Object.values(faces))for(let j=0;j<fh;j++)for(let i=0;i<fw;i++)dot(x+i,y+j,base);return faces}
function rows(faces,face,pattern){const [x,y,w,h]=faces[face];if(pattern.length!==h||pattern.some(s=>s.length!==w))throw new Error('Invalid '+face+' pattern');pattern.forEach((row,j)=>[...row].forEach((c,i)=>dot(x+i,y+j,c)))}
const head=part(0,0,8,8,8,'W'),body=part(16,16,8,12,4,'T'),rightArm=part(40,16,4,12,4,'A'),leftArm=part(32,48,4,12,4,'A'),rightLeg=part(0,16,4,12,4,'V'),leftLeg=part(16,48,4,12,4,'V')
rows(head,'front',['WWWWWWWW','WwWWWWwW','WEWppWEW','WPPppPPW','BBbbbBBB','BbmMMmbB','bbMMMMbb','BbbmmmbB'])
rows(head,'back',['WwWWWWWW','wwWWWWwW','wWWWWWWW','WWWWWwWW','WWWwWWWW','WWWWWWWW','wWWWWWWw','BBWWWWBB'])
rows(head,'left',['wWWWWWWW','wwWWWWWW','wWWWWWWW','WWWwWWWW','WWWBBBBB','WwWBBBBB','WWWBbbBB','WWWBbBBB'])
rows(head,'right',['WWWWWWWw','WWWWWWww','WWWWWWWw','WWWWwWWW','BBBBBWWW','BBBBBWwW','BBbbBWWW','BBBbBWWW'])
rows(head,'top',['WwWWWWWW','wWWWWWWW','WWWWWwWW','WWWwWWWW','WWWWWWWW','WWWWWWWw','WWWWWWww','WWwWWWWW'])
rows(body,'front',['TWwTTwWT','TWwTTwWT','TWwTTwWT','TWwTTwWT','TTwTTwTT','TTCTTTTT','TTCCTTtT','TTCCTTtT','tTTTTttT','tTTTttTT','TTTtTTTT','TTTTTtTT'])
rows(body,'back',['BBWWWWBB','TTTTTTTT','TTTtTTTT','TTttTtTT','TTttTttT','TTttTttT','TTttTttT','TTttTttT','TTTTTttT','tTTTTTTT','TtTTTTTT','TTTTTTtT'])
for(const side of ['left','right'])rows(body,side,['TTTT','TCTT','TCTT','TTtT','TTtT','TttT','TTtT','TTtT','TTTT','tTTT','TTtT','TTTT'])
for(const [arm,mirror] of [[rightArm,false],[leftArm,true]]){
 for(const side of ['front','back','left','right'])rows(arm,side,['TTTT','TCTT','TCtT','TTtT','AAAA','AahA','aahh','AaAh','AAha','AhAa','aaAA','aAAA'].map(r=>mirror?[...r].reverse().join(''):r))
 rows(arm,'top',['TTTT','TCTT','TCTT','TTTT'])
}
for(const [leg,mirror] of [[rightLeg,false],[leftLeg,true]]){
 for(const side of ['front','back','left','right'])rows(leg,side,['VVVV','VLlV','VLlV','VVVV','VVvV','VVvV','VvvV','VVVV','VLlV','VVVV','SSSS','SSSS'].map(r=>mirror?[...r].reverse().join(''):r))
 rows(leg,'bottom',['SSSS','SSSS','SSSS','SSSS'])
}
fs.mkdirSync(path.dirname(target),{recursive:true})
sharp(pixels,{raw:{width:64,height:64,channels:4}}).png().toFile(target).then(()=>process.stdout.write('Kamu front/back reference texture generated.\n')).catch(error=>{process.stderr.write(error.stack);process.exitCode=1})
