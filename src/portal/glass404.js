import * as THREE from 'three'

// Chiffres dessinés à la main (pas de police à charger) : 4, 0, 4, extrudés et biseautés.
// Toutes les cotes sont en unités locales ; le groupe est centré sur le trou du « 0 ».
const DIGIT_WIDTH = 2.6
const DIGIT_HEIGHT = 3.6
const STROKE = 0.7
const GAP = 0.55
const DEPTH = 1.4

function roundedRect(shape, x, y, width, height, radius) {
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0, false)
  shape.lineTo(x + width, y + height - radius)
  shape.absarc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false)
  shape.lineTo(x + radius, y + height)
  shape.absarc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false)
  shape.lineTo(x, y + radius)
  shape.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false)
}

function createZero() {
  const shape = new THREE.Shape()
  roundedRect(shape, 0, 0, DIGIT_WIDTH, DIGIT_HEIGHT, DIGIT_WIDTH / 2 - 0.1)
  const hole = new THREE.Path()
  const innerWidth = DIGIT_WIDTH - 2 * STROKE
  roundedRect(hole, STROKE, STROKE, innerWidth, DIGIT_HEIGHT - 2 * STROKE, innerWidth / 2 - 0.1)
  shape.holes.push(hole)
  return shape
}

function createFour() {
  const shape = new THREE.Shape()
  // Contour : pied de la hampe, barre transversale, puis la diagonale qui remonte.
  const points = [
    [1.6, 0], [2.3, 0], [2.3, 0.8], [2.6, 0.8], [2.6, 1.45], [2.3, 1.45],
    [2.3, 3.6], [1.05, 3.6], [0, 1.45], [0, 0.8], [1.6, 0.8],
  ]
  shape.moveTo(...points[0])
  for (const point of points.slice(1)) shape.lineTo(...point)
  // Le triangle vide, entre la diagonale, la hampe et la barre.
  const hole = new THREE.Path()
  hole.moveTo(0.8, 1.45)
  hole.lineTo(1.6, 1.45)
  hole.lineTo(1.6, 3.09)
  shape.holes.push(hole)
  return shape
}

const extrusion = {
  depth: DEPTH,
  curveSegments: 32,
  bevelEnabled: true,
  bevelThickness: 0.14,
  bevelSize: 0.12,
  bevelSegments: 6,
}

export function createGlass404() {
  const group = new THREE.Group()
  const glyphs = [createFour(), createZero(), createFour()]
  const geometries = glyphs.map((shape, index) => {
    const geometry = new THREE.ExtrudeGeometry(shape, extrusion)
    geometry.translate(index * (DIGIT_WIDTH + GAP), 0, 0)
    return geometry
  })
  // Le centre du « 0 » (au milieu) devient l'origine : c'est là que la caméra plonge.
  const centerX = DIGIT_WIDTH + GAP + DIGIT_WIDTH / 2
  // Pas de transmission (coûteuse : rendu supplémentaire de la scène) : le verre est un matériau
  // noir en mélange additif. Il ne fait qu'ajouter ses reflets sur l'espace visible derrière.
  const material = new THREE.MeshPhysicalMaterial({
    color: '#000000',
    metalness: 0,
    roughness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0,
    envMapIntensity: 0.6,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  for (const geometry of geometries) {
    geometry.translate(-centerX, -DIGIT_HEIGHT / 2, -DEPTH / 2)
    group.add(new THREE.Mesh(geometry, material))
  }
  group.scale.setScalar(1.5)

  return {
    group,
    material,
    baseEnvIntensity: material.envMapIntensity,
    baseClearcoat: material.clearcoat,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}
