// Deterministic vector compilation: retain the authored 16-unit paths at the
// existing 15 CSS-pixel feedback size. No image generation or style conversion.
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp')
async function compileFeedback(directory=path.resolve(__dirname,'../src/renderer/src/assets/mascot-feedback')){
 const outputs=[]
 for(const name of ['pixel-palm','palm-print']){
  const source=await fs.readFile(path.join(directory,name+'.svg'))
  const image=await sharp(source,{density:72}).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toBuffer()
  await fs.writeFile(path.join(directory,name+'.png'),image);outputs.push({name,bytes:image.length})
 }
 return outputs
}
module.exports={compileFeedback}
if(require.main===module)compileFeedback().then(outputs=>console.log(JSON.stringify(outputs))).catch(error=>{console.error(error);process.exitCode=1})
