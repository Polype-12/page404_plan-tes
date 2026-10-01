import * as THREE from 'three'
import { LOOP_LENGTH } from './planets.js'

// Trois lots suffisent pour dessiner toutes les particules, sans objet par point.
// Chaque lot contient des particules proches et lointaines, fixes dans le monde 3D.
// Le décor se répète tous les LOOP_LENGTH : chaque lot est dessiné par deux tuiles (mêmes points,
// même géométrie) qui suivent la caméra, comme les astres de planets.js.
// Une petite part des particules devient des étoiles : plus grosses, plus vives (le bloom de
// postprocessing.js les diffuse), avec un halo et un scintillement lent propres à chacune. Tout se
// passe dans le shader des particules existantes : aucun objet, aucune lumière, aucun appel en plus.
const STAR_RATIO = 0.025
const STAR_SIZE = 6
const STAR_GLOW = 3
// aStar : 0 pour une particule ordinaire, 1 + phase (0 à 1) pour une étoile.
const starVertex = /* glsl */ `
  attribute float aStar;
  uniform float uTime;
  varying float vStar;
  varying float vGlow;
`
const starSize = /* glsl */ `
  vStar = step(0.5, aStar);
  float phase = (aStar - 1.0) * 6.2831853;
  float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + 0.8 * fract(phase)) + phase);
  vGlow = mix(1.0, ${STAR_GLOW.toFixed(1)} * twinkle, vStar);
  gl_PointSize = size * mix(1.0, ${STAR_SIZE.toFixed(1)} * (0.85 + 0.15 * twinkle), vStar);
`
const starFragment = /* glsl */ `
  #include <map_particle_fragment>
  if (vStar > 0.5) {
    // Cœur net et halo doux, dessinés à la place du disque plein.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 0.18, d);
    float halo = exp(-d * d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d));
    diffuseColor.a = clamp(core + halo * 0.7, 0.0, 1.0) * opacity;
  }
  diffuseColor.rgb *= vGlow;
`

export function createParticles(scene, planets) {
  const time = { value: 0 }
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
    const stars = []
    const position = new THREE.Vector3()
    for (let i = 0; i < 500; i++) {
      const nearby = i < 75
      const spread = nearby ? 70 : 400
      do {
        position.set(
          THREE.MathUtils.randFloatSpread(spread * 2),
          THREE.MathUtils.randFloatSpread(spread * 2),
          nearby ? THREE.MathUtils.randFloat(-35, 15) : THREE.MathUtils.randFloat(-LOOP_LENGTH, -35),
        )
      } while (planets.some(({ center, radius }) => position.distanceTo(center) < radius + 1))
      positions.push(position.x, position.y, position.z)
      stars.push(Math.random() < STAR_RATIO ? 1 + Math.random() : 0)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aStar', new THREE.Float32BufferAttribute(stars, 1))
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
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time
      shader.vertexShader = starVertex + shader.vertexShader.replace('gl_PointSize = size;', starSize)
      shader.fragmentShader = 'varying float vStar;\nvarying float vGlow;\n'
        + shader.fragmentShader.replace('#include <map_particle_fragment>', starFragment)
    }
    const tiles = [new THREE.Points(geometry, material), new THREE.Points(geometry, material)]
    scene.add(...tiles)
    return { tiles, geometry, material }
  })

  return {
    // seconds : horloge du scintillement (figée si l'on préfère réduire les animations).
    update(camera, seconds = 0) {
      time.value = seconds
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
