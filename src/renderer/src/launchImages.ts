import { BUILTIN_LAUNCH_IMAGES } from '@shared/launchImages'
import piston from './assets/launch/piston.webp'
import brewer from './assets/launch/brewer.webp'
import cannon from './assets/launch/cannon.webp'
import cactus from './assets/launch/cactus.webp'
import farmer from './assets/launch/farmer.webp'
import camp from './assets/launch/camp.webp'
import sunset from './assets/launch/sunset.webp'

const sources = { 'piston.webp': piston, 'brewer.webp': brewer, 'cannon.webp': cannon,
  'cactus.webp': cactus, 'farmer.webp': farmer, 'camp.webp': camp, 'sunset.webp': sunset }
export const builtInLaunchImages = BUILTIN_LAUNCH_IMAGES.map(image => ({ ...image, src: sources[image.file] }))
