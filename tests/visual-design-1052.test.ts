import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanDesign, snapped } from '../src/shared/visualDesign'
import { visualIds } from '../scripts/visual-ids'
test('布局 schema 保留独立页面和全部组件字段，拒绝脚本/非有限数字，并支持重置空值',()=>{
 const input={version:1,pages:{home:{width:1400,height:900,components:{'Home:abc~0':{x:24,y:-8,width:400,height:200,color:'#123456',background:'rgba(1,2,3,0.4)',opacity:.4,radius:20,blur:16,fontSize:30,fontFamily:'Microsoft YaHei',fontWeight:700,text:'自定义 <b>文字</b>',hidden:true,order:2}}},'keys/game/mouse':{width:1400,height:900,components:{'input~0':{x:5}}}}}
 const expected=structuredClone(input) as any;for(const p of Object.values(expected.pages) as any[])for(const c of Object.values(p.components) as any[])c.mode='free';assert.deepEqual(JSON.parse(JSON.stringify(cleanDesign(input))),expected)
 const bad=cleanDesign({version:1,pages:{home:{components:{'x':{color:'url(javascript:alert(1))',x:Infinity,fontFamily:'a;display:none',opacity:5}}}}});assert.deepEqual({...bad.pages.home.components.x},{opacity:1});assert.deepEqual(cleanDesign(null),{version:1,pages:{}})
 assert.equal(snapped(102,[100,200]).value,100);assert.equal(snapped(102,[100],false).value,102)
})
test('可视化标识覆盖原生按钮/文字，源码文案变化保持标识，编辑工具不加入画布',()=>{
 const plugin=visualIds();const source='<template><div class="card"><button><span>原文</span></button><input /></div></template>'
 const a=plugin.transform(source,'/test/Example.vue')!.code,b=plugin.transform(source.replace('原文','新文'),'\u002ftest/Example.vue')!.code
 assert.equal((a.match(/data-ui=/g)||[]).length,4);assert.deepEqual(a.match(/data-ui="[^"]+"/g),b.match(/data-ui="[^"]+"/g));assert.equal(plugin.transform(source,'/test/EditPanel.vue'),undefined)
})
