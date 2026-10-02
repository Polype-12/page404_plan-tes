import * as THREE from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'

// Chiffres dessinés à la main (pas de police à charger) : 4, 0, 4, extrudés et biseautés.
// Toutes les cotes sont en unités locales ; le groupe est centré sur le trou du « 0 ».
const DIGIT_WIDTH = 2.6
const DIGIT_HEIGHT = 3.6
const STROKE = 0.7
const GAP = 0.55
// Épaisseur totale, chanfreins compris : la face avant reste au même endroit quel que soit le chanfrein
// (le plan de la fenêtre sert à la plongée, voir main_404.js).
const DEPTH = 1.5

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

// Chanfrein des arêtes verticales : chaque coin du contour est coupé à `size` de part et d'autre
// (au plus 45 % de chaque côté, pour ne jamais croiser le coin voisin).
function chamferCorners(points, size) {
  if (size <= 0) return points
  const result = []
  points.forEach(([x, y], index) => {
    const [px, py] = points[(index - 1 + points.length) % points.length]
    const [nx, ny] = points[(index + 1) % points.length]
    const before = Math.hypot(px - x, py - y)
    const after = Math.hypot(nx - x, ny - y)
    const cutBefore = Math.min(size, before * 0.45)
    const cutAfter = Math.min(size, after * 0.45)
    result.push([x + (px - x) / before * cutBefore, y + (py - y) / before * cutBefore])
    result.push([x + (nx - x) / after * cutAfter, y + (ny - y) / after * cutAfter])
  })
  return result
}

function polygon(path, points) {
  path.moveTo(...points[0])
  for (const point of points.slice(1)) path.lineTo(...point)
  return path
}

function createFour(chamfer) {
  // Contour : pied de la hampe, barre transversale, puis la diagonale qui remonte.
  const shape = polygon(new THREE.Shape(), chamferCorners([
    [1.6, 0], [2.3, 0], [2.3, 0.8], [2.6, 0.8], [2.6, 1.45], [2.3, 1.45],
    [2.3, 3.6], [1.05, 3.6], [0, 1.45], [0, 0.8], [1.6, 0.8],
  ], chamfer))
  // Le triangle vide, entre la diagonale, la hampe et la barre.
  shape.holes.push(polygon(new THREE.Path(), chamferCorners([[0.8, 1.45], [1.6, 1.45], [1.6, 3.09]], chamfer)))
  return shape
}

export const HALO_LAYER = 1

// Chanfrein plat (un seul segment) à 45°, sur les arêtes des faces et sur les arêtes verticales.
// chamfer : largeur en unités locales (×1,5 dans le monde), réglable dans le panneau « Glow 404 ».
export const CHAMFER = { chamfer: 0.03 }
export const MAX_CHAMFER = 0.2

function extrusion(chamfer) {
  return {
    depth: DEPTH - 2 * chamfer,
    curveSegments: 24,
    bevelEnabled: chamfer > 0,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelSegments: 1,
  }
}

// windowMaterial : matériau de toutes les faces (faces planes, flancs et chanfrein) : la fenêtre.
// Par-dessus, une peau de verre (même géométrie) n'ajoute que ses reflets : sa couleur est noire et
// elle est mélangée en additif, l'espace reste visible au travers. Indice de réfraction élevé et pas
// de vernis : la face avant reflète presque autant que les flancs vus en biais.
export const GLASS = { reflections: 0.3 }

// Le centre du « 0 » (au milieu) devient l'origine : c'est là que la caméra plonge.
const CENTER_X = DIGIT_WIDTH + GAP + DIGIT_WIDTH / 2

function createGeometries(chamfer) {
  const glyphs = [createFour(chamfer), createZero(), createFour(chamfer)]
  return glyphs.map((shape, index) => {
    // ExtrudeGeometry calcule des normales plates (une par triangle) : les reflets du verre montraient
    // les facettes des courbes. Normales lissées sous 30°, arêtes vives (faces, chanfreins) conservées.
    const geometry = toCreasedNormals(new THREE.ExtrudeGeometry(shape, extrusion(chamfer)), THREE.MathUtils.degToRad(30))
    // Épaisseur centrée sur z = 0 : de -DEPTH/2 à +DEPTH/2, chanfreins compris.
    geometry.translate(index * (DIGIT_WIDTH + GAP) - CENTER_X, -DIGIT_HEIGHT / 2, chamfer - DEPTH / 2)
    geometry.computeBoundingBox()
    return geometry
  })
}

export function createGlass404(windowMaterial) {
  const group = new THREE.Group()
  let chamfer = CHAMFER.chamfer
  let geometries = createGeometries(chamfer)
  const material = new THREE.MeshPhysicalMaterial({
    color: '#000000',
    metalness: 0,
    roughness: 0.05,
    ior: 2.33,
    envMapIntensity: GLASS.reflections,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Même surface que la fenêtre : décalage de profondeur vers la caméra, sans quoi les deux
    // matériaux (calculs de position différents) se disputent les pixels.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })
  const scale = 1.5
  // Calque du halo (portal.js) : reflets du verre, et faces « fenêtre » qui les masquent.
  const windows = []
  const skins = []
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, windowMaterial)
    mesh.layers.enable(HALO_LAYER)
    windows.push(mesh)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Dessinée après la fenêtre, juste devant elle (voir polygonOffset).
    const skin = new THREE.Mesh(geometry, material)
    skin.renderOrder = 1
    // Les reflets sont la source du halo (portal.js).
    skin.layers.enable(HALO_LAYER)
    skins.push(skin)
    group.add(mesh, skin)
  }
  group.scale.setScalar(scale)

  // Bas des chiffres (chanfrein compris), en unités du monde.
  function bottom() {
    return Math.min(...geometries.map((geometry) => geometry.boundingBox.min.y)) * scale
  }

  return {
    group,
    windows,
    material,
    // Profondeur de la face avant (le plan de la fenêtre), en unités du monde : fixe.
    frontZ: (DEPTH / 2) * scale,
    // Bas des chiffres (chanfrein compris) : le sol y affleure. Il descend un peu avec le chanfrein.
    get bottomY() {
      return bottom()
    },
    // Demi-largeur du « 404 » (chanfrein compris), en unités du monde : pour le cadrage (main_404.js).
    get halfWidth() {
      return Math.max(...geometries.map((geometry) => Math.max(-geometry.boundingBox.min.x, geometry.boundingBox.max.x))) * scale
    },
    get chamfer() {
      return chamfer
    },
    // Reconstruit les chiffres avec un autre chanfrein (quelques milliers de triangles : immédiat).
    setChamfer(value) {
      chamfer = THREE.MathUtils.clamp(value, 0, MAX_CHAMFER)
      const previous = geometries
      geometries = createGeometries(chamfer)
      geometries.forEach((geometry, index) => {
        windows[index].geometry = geometry
        skins[index].geometry = geometry
      })
      for (const geometry of previous) geometry.dispose()
    },
    // Milieu des jambages gauche et droit du « 0 » : là où la caméra plonge (x = ±entryX, y = 0).
    entryX: (DIGIT_WIDTH / 2 - STROKE / 2) * scale,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}
