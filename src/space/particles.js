import * as THREE from 'three'
import { LOOP_LENGTH } from './planets.js'

// Trois lots suffisent pour dessiner toutes les particules, sans objet par point.
// Chaque lot contient des particules proches et lointaines, fixes dans le monde 3D.
// Le décor se répète tous les LOOP_LENGTH : chaque lot est dessiné par deux tuiles (mêmes points,
// même géométrie) qui suivent la caméra, comme les astres de planets.js.
export function createParticles(scene, planets) {
  // Un petit disque blanc partagé pour obtenir des points ronds.
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(16, 16, 14, 0, Math.PI * 2)
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const fields = [0.08, 0.16, 0.28].map((size) => {
    const positions = []
    const position = new THREE.Vector3()
    for (let i = 0; i < 500; i++) {
      const nearby = i < 75
      const spread = nearby ? 35 : 200
      do {
        position.set(
          THREE.MathUtils.randFloatSpread(spread * 2),
          THREE.MathUtils.randFloatSpread(spread * 2),
          nearby ? THREE.MathUtils.randFloat(-35, 15) : THREE.MathUtils.randFloat(-LOOP_LENGTH, -35),
        )
      } while (planets.some(({ center, radius }) => position.distanceTo(center) < radius + 1))
      positions.push(position.x, position.y, position.z)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: '#ffffff',
      size,
      map: texture,
      sizeAttenuation: true,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      toneMapped: false,
    })
    const tiles = [new THREE.Points(geometry, material), new THREE.Points(geometry, material)]
    scene.add(...tiles)
    return { tiles, geometry, material }
  })

  return {
    update(camera) {
      // Deux tuiles contiguës couvrent de la caméra jusqu'au fond de l'horizon.
      const end = Math.ceil(camera.position.z / LOOP_LENGTH) * LOOP_LENGTH
      for (const { tiles } of fields) {
        tiles[0].position.z = end
        tiles[1].position.z = end - LOOP_LENGTH
      }
    },
    dispose() {
      for (const { geometry, material } of fields) {
        geometry.dispose()
        material.dispose()
      }
      texture.dispose()
    },
  }
}
