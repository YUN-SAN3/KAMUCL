import test from 'node:test'
import assert from 'node:assert/strict'
import { resourceDisplayName, pageSelection, terracottaRole } from '../src/shared/uiPresentation'
import { resolveComponentDesign } from '../src/shared/visualDesign'
test('managed resource display names keep unrecognized filenames intact',()=>{
 const name='My-Pack-版本.zip';assert.equal(resourceDisplayName('KAMUCL-default-'+'a'.repeat(64)+'-'+name),name)
 for(const bad of ['KAMUCL-default-abc-'+name,'KAMUCL-default-'+'z'.repeat(64)+'-'+name,name])assert.equal(resourceDisplayName(bad),bad)
})
test('current-page selection excludes other pages and reports partial selection',()=>{
 assert.deepEqual(pageSelection([],new Set(['other'])),{all:false,partial:false})
 assert.deepEqual(pageSelection(['a','b'],new Set(['a','other'])),{all:false,partial:true})
 assert.deepEqual(pageSelection(['a','b'],new Set(['a','b','other'])),{all:true,partial:false})
})
test('Terracotta room code on guest does not hide its game address',()=>{
 assert.equal(terracottaRole({phase:'ready',room:'U/AAAA-BBBB-CCCC-DDDD',url:'127.0.0.1:25565'}),'guest')
 assert.equal(terracottaRole({phase:'ready',room:'U/AAAA-BBBB-CCCC-DDDD'}),'host')
 assert.equal(terracottaRole({phase:'joining',room:'U/AAAA-BBBB-CCCC-DDDD'}),'guest')
 assert.equal(terracottaRole({phase:'idle',room:'old'}),'none')
})
test('moved unique appearance overrides survive without guessing ambiguous controls',()=>{
 const custom={fontSize:18};assert.equal(resolveComponentDesign({'old/field~0':custom},'new/field~0'),custom)
 assert.equal(resolveComponentDesign({'old/field~0':custom,'other/field~0':{fontSize:20}},'new/field~0'),undefined)
 assert.equal(resolveComponentDesign({'old/field~0':custom},'old/field~0'),custom)
})
