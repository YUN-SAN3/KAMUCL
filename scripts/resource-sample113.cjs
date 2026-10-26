// Empty is not equivalent to unobserved/partial. Historical complete Mac
// samples need no new flags; any explicit invalidation prevents an exit proof.
function isCompleteEmptyNativeSample(sample){
 return sample?.event==='sample'&&Array.isArray(sample.rows)&&sample.rows.length===0&&sample.wholeTreeCountersComplete!==false&&sample.completeFullTree!==false&&['counterErrors','partialRows','invalidatedRows','lifecycleInvalidations','identityInvalidations','optionalCounterErrors'].every(key=>sample[key]===undefined||(Array.isArray(sample[key])&&sample[key].length===0))
}
module.exports={isCompleteEmptyNativeSample}
