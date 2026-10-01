import * as THREE from 'three'

// Brouillard exponentiel : les astres lointains se fondent dans la couleur du brouillard.
// density : quantité de brouillard (0 = espace clair). sky : part de la couleur du brouillard
// dans le fond (1 = le ciel est entièrement noyé, cohérent avec les astres les plus lointains).
export const FOG = { color: '#000000', density: 0.0025, sky: 1 }

export function createFog(scene) {
  const black = new THREE.Color('#000000')
  const fog = new THREE.FogExp2(FOG.color, FOG.density)
  const settings = { ...FOG }
  scene.fog = fog
  scene.background = new THREE.Color()

  function apply() {
    fog.color.set(settings.color)
    fog.density = settings.density
    // Sans brouillard, le fond reste noir quelle que soit la part du ciel.
    const amount = settings.density > 0 ? settings.sky : 0
    scene.background.copy(black).lerp(fog.color, amount)
  }
  apply()

  return { settings, apply }
}
