import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// Halo discret : seules les zones les plus éclairées débordent légèrement,
// comme la diffusion d'une optique d'appareil photo.
const BLOOM = { strength: 0.07, radius: 0.47, threshold: 0.04 }

export function createPostprocessing(renderer, scene, camera) {
  // Rendu en virgule flottante (les zones éclairées dépassent 1) avec antialiasing MSAA.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(bloom)
  // Conversion finale en sRGB pour l'écran.
  composer.addPass(new OutputPass())

  return {
    // Exposé pour le panneau de réglage (strength, radius, threshold).
    bloom,
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
