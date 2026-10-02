import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),observe=require('../scripts/pcl-title-frame-119.cjs')
test('PCL game QA rejects loading/uniform/progress frames and observes separated menu buttons',()=>{
 const width=400,height=300,rgb=new Uint8Array(width*height*3)
 const fill=(r:number,g:number,b:number)=>{for(let i=0;i<rgb.length;i+=3){rgb[i]=r;rgb[i+1]=g;rgb[i+2]=b}}
 const bar=(top:number,bottom:number)=>{for(let y=top;y<bottom;y++)for(let x=50;x<350;x++){const k=(y*width+x)*3;rgb[k]=rgb[k+1]=rgb[k+2]=120}}
 fill(237,55,64);assert.equal(observe(width,height,rgb).menuLike,false)
 bar(245,254);assert.equal(observe(width,height,rgb).menuLike,false,'one progress bar is not a menu')
 fill(120,120,120);assert.equal(observe(width,height,rgb).menuLike,false,'uniform gray is not multiple buttons')
 fill(25,50,75);bar(170,187);bar(210,227);bar(250,267)
 assert.equal(observe(width,height,rgb).menuLike,true);assert.equal(observe(width,height,rgb).bands.length,3)
 assert.throws(()=>observe(width,height,rgb.subarray(3)),/Invalid RGB/)
})
