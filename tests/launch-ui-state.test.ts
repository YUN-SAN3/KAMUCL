import test from 'node:test'
import assert from 'node:assert/strict'
import { activeLaunchStates, rememberLaunchState } from '../src/main/core/launchUiState'
test('reopened window restores concurrent owned games and drops completed sessions',()=>{
  rememberLaunchState({launchId:'mac-a',versionId:'same',folder:'/A',status:'running',text:'running'})
  rememberLaunchState({launchId:'mac-b',versionId:'same',folder:'/B',status:'launching',text:'downloading'})
  assert.equal(activeLaunchStates().length,2)
  const copy=activeLaunchStates();copy[0].status='exited'
  assert.equal(activeLaunchStates()[0].status,'running')
  rememberLaunchState({launchId:'mac-a',status:'exited',text:'saved'})
  assert.deepEqual(activeLaunchStates().map(x=>x.launchId),['mac-b'])
  rememberLaunchState({launchId:'mac-b',status:'error',text:'cancelled'})
  assert.equal(activeLaunchStates().length,0)
})
