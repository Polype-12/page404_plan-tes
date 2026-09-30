import * as THREE from 'three'
import { atmosphereFragmentShader, atmosphereVertexShader } from './shaders.js'

// color : teinte diffusée (bleu = ciel terrestre, couchers rougeâtres au terminateur).
// intensity : luminosité. thickness : hauteur en fraction du rayon. density : opacité.
// mie / mieG : quantité de brume et force du halo à contre-jour.
export function createAtmosphere(geometry, sunUniforms, {
  color = '#88c9ff', intensity = 1, thickness = 0.05, density = 1, mie = 1, mieG = 0.76,
} = {}) {
  // Légère marge : les facettes de la sphère ne rognent pas le bord de l'atmosphère.
  const shellScale = (1 + thickness) * 1.01
  const material = new THREE.ShaderMaterial({
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    uniforms: {
      ...sunUniforms,
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uThickness: { value: thickness },
      uDensity: { value: density },
      uMie: { value: mie },
      uMieG: { value: mieG },
      uShellScale: { value: shellScale },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(shellScale)
  return mesh
}

const center = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const scale = new THREE.Vector3()

// Caméra dans l'atmosphère : on dessine la coque par l'intérieur pour ne pas la perdre.
export function updateAtmosphereSides(atmospheres, camera) {
  for (const atmosphere of atmospheres) {
    atmosphere.matrixWorld.decompose(center, rotation, scale)
    const inside = camera.position.distanceTo(center) < scale.x
    atmosphere.material.side = inside ? THREE.BackSide : THREE.FrontSide
  }
}
