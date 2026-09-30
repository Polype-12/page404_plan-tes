import * as THREE from 'three'

// Soleil unique et lointain : lumière directionnelle blanche, sans lumière ambiante,
// pour que la face nocturne des astres reste entièrement noire.
export function createSun(scene) {
  const direction = new THREE.Vector3(-1, 0.25, 0.45).normalize()
  // Même éclairement pour les surfaces et les atmosphères : aucune surexposition relative.
  const intensity = 4

  const light = new THREE.DirectionalLight('#ffffff', intensity)
  light.castShadow = true
  light.shadow.mapSize.set(4096, 4096)
  // Volume d'ombre qui suit la caméra le long du couloir (voir follow).
  const shadowCamera = light.shadow.camera
  shadowCamera.left = shadowCamera.bottom = -110
  shadowCamera.right = shadowCamera.top = 110
  shadowCamera.near = 1
  shadowCamera.far = 600
  shadowCamera.updateProjectionMatrix()
  light.shadow.bias = -0.0005
  light.shadow.normalBias = 0.05
  scene.add(light, light.target)

  return {
    // Uniformes partagés par tous les shaders d'atmosphère.
    uniforms: {
      uSunDirection: { value: direction },
      uSunIntensity: { value: intensity },
    },
    follow(camera) {
      // Centre du volume d'ombre un peu devant la caméra, là où se trouvent les astres visibles.
      light.target.position.set(camera.position.x, camera.position.y, camera.position.z - 90)
      light.position.copy(light.target.position).addScaledVector(direction, 300)
    },
    dispose() {
      light.dispose()
    },
  }
}
