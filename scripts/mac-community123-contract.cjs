const {validateAssets,extractPackagedRenderer,sha}=require('./mac-auth122-contract.cjs')
const {validateUiProof}=require('./qa-community123.cjs')
module.exports={validateAssets,extractPackagedRenderer,sha,validateUiProof:(proof,expected)=>validateUiProof(proof,{...expected,platform:'darwin',arch:'arm64'})}
