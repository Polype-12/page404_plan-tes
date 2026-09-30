import * as THREE from 'three'

// Trois lots suffisent pour dessiner toutes les particules, sans objet par point.
// Chaque lot contient des particules proches et lointaines, fixes dans le monde 3D.
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
    for (let i = 0; i < 1000; i++) {
      const nearby = i < 150
      const spread = nearby ? 35 : 200
      do {
        position.set(
          THREE.MathUtils.randFloatSpread(spread * 2),
          THREE.MathUtils.randFloatSpread(spread * 2),
          nearby ? THREE.MathUtils.randFloat(-35, 15) : THREE.MathUtils.randFloat(-1000, -35),
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
    const points = new THREE.Points(geometry, material)
    scene.add(points)
    return points
  })

  return {
    dispose() {
      for (const { geometry, material } of fields) {
        geometry.dispose()
        material.dispose()
      }
      texture.dispose()
    },
  }
}
