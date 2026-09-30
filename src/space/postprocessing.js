import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// Halo discret : seules les zones les plus éclairées débordent légèrement,
// comme la diffusion d'une optique d'appareil photo.
const BLOOM = { strength: 0.07, radius: 0.15, threshold: 0.37 }

// toScreen : false pour rendre l'espace dans une texture (sans conversion sRGB) réutilisée ailleurs.
export function createPostprocessing(renderer, scene, camera, { toScreen = true } = {}) {
  // Rendu en virgule flottante (les zones éclairées dépassent 1) avec antialiasing MSAA.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(bloom)
  // Conversion finale en sRGB pour l'écran.
  if (toScreen) composer.addPass(new OutputPass())
  else composer.renderToScreen = false

  return {
    // Exposé pour le panneau de réglage (strength, radius, threshold).
    bloom,
    // Image finale (linéaire) quand toScreen est faux : le halo est ajouté sur le tampon de lecture.
    get texture() {
      return composer.readBuffer.texture
    },
    render(delta) {
      composer.render(delta)
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
    },
    dispose() {
      bloom.dispose()
      composer.dispose()
    },
  }
}
