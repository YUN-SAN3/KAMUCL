// Read-only QA geometry and original trusted input observations. No click,
// renderer state assignment, requested-size substitution or retry lives here.
const assert=require('node:assert/strict')
function coordinateExpression(selector,{absentSelectors=[]}={}){
 assert.equal(typeof selector,'string');assert(selector);assert(Array.isArray(absentSelectors)&&absentSelectors.every(s=>typeof s==='string'&&s))
 return `(()=>{const renderer={width:innerWidth,height:innerHeight,hasFocus:document.hasFocus(),hidden:document.hidden,pixelRatio:devicePixelRatio,timeOrigin:performance.timeOrigin,url:location.href,ready:document.readyState},absent=${JSON.stringify(absentSelectors)}.every(s=>!document.querySelector(s)),e=document.querySelector(${JSON.stringify(selector)});if(!e)return{hit:false,absent,renderer};const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;let ancestorsVisible=true,runningAnimations=0;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);ancestorsVisible=ancestorsVisible&&Number(s.opacity)>=.999&&s.visibility==='visible'&&s.display!=='none';runningAnimations+=n.getAnimations().filter(a=>a.playState==='running'||a.pending).length}return{hit:e.isConnected&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&!e.disabled&&!e.closest('[inert]')&&e.contains(document.elementFromPoint(x,y)),x,y,bounds:r.toJSON(),label:e.getAttribute('aria-label')||e.textContent.trim(),ancestorsVisible,runningAnimations,absent,renderer}})()`
}
function coordinateGeometryReady(row,previous,expected){
 const finite=n=>Number.isFinite(n),rect=r=>r&&['x','y','width','height'].every(k=>finite(r[k]))&&r.width>0&&r.height>0
 const ready=value=>{
  const n=value?.native,c=value?.coordinate,r=c?.renderer
  return n&&c&&r&&['pid','windowId','webContentsId'].every(k=>Number.isInteger(expected[k])&&expected[k]>0&&n[k]===expected[k])&&n.visible===true&&n.minimized===false&&n.focused===true&&n.appHidden===false&&rect(n.bounds)&&rect(n.contentBounds)&&finite(n.zoom)&&n.zoom>0&&(expected.zoom===undefined||n.zoom===expected.zoom)&&r.width===Math.round(n.contentBounds.width/n.zoom)&&r.height===Math.round(n.contentBounds.height/n.zoom)&&r.hasFocus===true&&r.hidden===false&&r.ready==='complete'&&finite(r.pixelRatio)&&r.pixelRatio>0&&finite(expected.timeOrigin)&&expected.timeOrigin>0&&r.timeOrigin===expected.timeOrigin&&typeof expected.url==='string'&&expected.url.length>0&&r.url===expected.url&&c.hit===true&&c.ancestorsVisible===true&&c.runningAnimations===0&&c.absent===true&&rect(c.bounds)&&finite(c.x)&&finite(c.y)&&c.x===c.bounds.x+c.bounds.width/2&&c.y===c.bounds.y+c.bounds.height/2&&c.bounds.x>=0&&c.bounds.y>=0&&c.bounds.x+c.bounds.width<=r.width&&c.bounds.y+c.bounds.height<=r.height
 }
 if(!ready(row)||!ready(previous))return false
 return row.native.zoom===previous.native.zoom&&['x','y','width','height'].every(k=>['bounds','contentBounds'].every(name=>row.native[name][k]===previous.native[name][k])&&row.coordinate.bounds[k]===previous.coordinate.bounds[k])&&row.coordinate.x===previous.coordinate.x&&row.coordinate.y===previous.coordinate.y&&['width','height','pixelRatio','timeOrigin','url'].every(k=>row.coordinate.renderer[k]===previous.coordinate.renderer[k])
}
async function waitForStableCoordinate({read,expected,deadline,now=()=>performance.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=75,onSample=()=>{}}){
 assert.equal(typeof read,'function');assert(Number.isFinite(deadline));assert(Number.isFinite(pollMs)&&pollMs>0)
 let previous,last
 while(now()<deadline){
  const remainingMs=deadline-now();let value,timer
  try{value=await Promise.race([Promise.resolve().then(()=>read(remainingMs)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original coordinate deadline elapsed during read')),remainingMs)})])}catch(error){value={observationError:{name:error.name,message:error.message}}}finally{clearTimeout(timer)}
  const at=now();last=value;onSample({at,value})
  if(at<deadline&&coordinateGeometryReady(value,previous,expected))return value
  previous=value;const remaining=deadline-now();if(remaining<=0)break;await wait(Math.min(pollMs,remaining))
 }
 const error=Error('Original coordinate deadline elapsed before two stable owned observations');error.code='QA_COORDINATE_DEADLINE';error.last=last;throw error
}
function installTrustedTargetObserver(){
 if(window.__qaCoordinateTargets114)throw Error('Owned trusted-target observer already installed')
 const origin=performance.timeOrigin,url=location.href,types=['pointerdown','pointerup','mousedown','mouseup','click'],limit=64;let active=null,serial=0
 const describe=e=>e?{tag:e.tagName,id:e.id||null,ui:e.getAttribute?.('data-ui')||null,nav:e.closest?.('[data-nav]')?.getAttribute('data-nav')||null,role:e.getAttribute?.('role')||null}:null
 const listener=event=>{if(!active)return;if(active.records.length>=limit){active.overflow=true;return}const target=event.target instanceof Element?event.target:null;active.records.push({type:event.type,isTrusted:event.isTrusted,at:performance.now(),timeOrigin:performance.timeOrigin,url:location.href,x:event.clientX,y:event.clientY,button:event.button,buttons:event.buttons,target:describe(target),matchesSelector:!!target?.closest(active.selector),renderer:{width:innerWidth,height:innerHeight,hasFocus:document.hasFocus(),hidden:document.hidden,pixelRatio:devicePixelRatio}})}
 for(const type of types)document.addEventListener(type,listener,{capture:true,passive:true})
 const observer={begin(selector){if(active)throw Error('An owned trusted-target observation is active');if(performance.timeOrigin!==origin||location.href!==url)throw Error('Owned trusted-target document changed');const token=String(origin)+':'+(++serial);active={token,selector,timeOrigin:origin,url,records:[],overflow:false};return token},finish(token){if(!active||active.token!==token)throw Error('Owned trusted-target token mismatch');const result=active;active=null;return result},restore(){if(active)throw Error('Cannot restore active trusted-target observation');for(const type of types)document.removeEventListener(type,listener,true);if(window.__qaCoordinateTargets114!==observer)throw Error('Owned trusted-target observer changed');delete window.__qaCoordinateTargets114;return{complete:true,timeOrigin:origin,url}}}
 window.__qaCoordinateTargets114=observer;return observer
}
const trustedTargetStartExpression=selector=>`(()=>{const o=window.__qaCoordinateTargets114||(${installTrustedTargetObserver.toString()})();return o.begin(${JSON.stringify(selector)})})()`
const trustedTargetStopExpression=token=>`window.__qaCoordinateTargets114.finish(${JSON.stringify(token)})`
const trustedTargetRestoreExpression=()=>`window.__qaCoordinateTargets114?window.__qaCoordinateTargets114.restore():({complete:true,absent:true})`
function assertTrustedTargetObservation(observation,expected){
 assert.equal(observation?.selector,expected.selector);assert.equal(observation.timeOrigin,expected.timeOrigin);assert.equal(observation.url,expected.url);assert.equal(observation.overflow,false,'Original trusted input ledger overflowed')
 assert(Array.isArray(observation.records));assert.equal(observation.records.length,5,'One original pointer/mouse/click sequence required')
 for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){const rows=observation.records.filter(row=>row.type===type);assert.equal(rows.length,1,'One original '+type+' required');const row=rows[0];assert.equal(row.isTrusted,true,'Native input must retain its original trusted flag');assert.equal(row.matchesSelector,true,'Original native input reached another target');assert.equal(row.timeOrigin,expected.timeOrigin);assert.equal(row.url,expected.url);assert(Number.isFinite(row.at)&&Number.isFinite(row.x)&&Number.isFinite(row.y));assert.equal(row.renderer?.hasFocus,true);assert.equal(row.renderer?.hidden,false)}
 return true
}
module.exports={coordinateExpression,coordinateGeometryReady,waitForStableCoordinate,installTrustedTargetObserver,trustedTargetStartExpression,trustedTargetStopExpression,trustedTargetRestoreExpression,assertTrustedTargetObservation}
