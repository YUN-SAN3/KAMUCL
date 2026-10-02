// Use the real active native display, never a fixture or a rounded capture FPS.
// A below-30Hz display cannot present a sustained 30 distinct frames per second.
module.exports=function mascotCaptureBudget(gpu,fps){
 const frequency=gpu?.activeDisplay?.displayFrequency
 const known=Number.isFinite(frequency)&&frequency>=10&&frequency<=500
 const minimumFps=known?Math.min(30,frequency):30
 return{nominalMinimumFps:30,minimumFps,activeDisplay:gpu?.activeDisplay??null,source:known?'minimum of nominal30 and real screen.getDisplayMatching(window.getBounds()).displayFrequency':'nominal30; missing/invalid native frequency does not relax acceptance',actualFps:fps,passed:Number.isFinite(fps)&&fps>=minimumFps}
}
