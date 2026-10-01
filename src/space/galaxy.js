import * as THREE from 'three'
import { loadSplatGalaxy } from './splat-galaxy.js'

// Fond de l'espace : une seule bande galactique très sombre, vue par la tranche, qui traverse le ciel
// en biais. Nuages doux, couloirs de poussière plus sombres, bulbe un peu plus chaud d'un côté et
// poussière d'étoiles très fine. Tout est calculé par un shader une seule fois, dans une texture cube
// (refaite seulement quand un réglage change) : le fond ne coûte rien à chaque image et reste à
// l'infini, il ne bouge que lorsque la vue tourne.
// brightness : luminosité maximale de la bande (rester sous ~0.08 pour ne pas concurrencer les astres).
// tilt : inclinaison de la bande à l'écran (radians). width : épaisseur angulaire de la bande.
// dust : opacité des couloirs de poussière. stars : densité de la poussière d'étoiles.
// cool / warm : teintes de la bande et du bulbe.
// splat… : galaxie en gaussian splatting (splat-galaxy.js), cuite dans le même fond, donc toujours
// derrière les astres. splatIntensity : luminosité (rester bas pour ne pas concurrencer les planètes).
// splatSize : diamètre apparent (degrés). splatYaw / splatPitch : direction dans le ciel (radians,
// 0 = droit devant, vers -z). splatTilt / splatSpin : inclinaison et rotation du disque.
// splatTint : teinte multipliée aux couleurs du fichier.
export const GALAXY = {
  brightness: 0.005,
  tilt: 0.99,
  width: 0.29,
  dust: 0.67,
  stars: 0.7,
  cool: '#354467',
  warm: '#9aa3c2',
  splatIntensity: 0.03,
  splatSize: 84,
  splatYaw: -0.61,
  splatPitch: 0.2,
  splatTilt: 1.05,
  splatSpin: -0.27,
  splatTint: '#c6d4ff',
}
const SPLAT_URL = 'galaxy/galaxy.compressed.ply'
// Distance de la galaxie au point de vue de la cuisson : dans la sphère du ciel (rayon 10).
const SPLAT_DISTANCE = 6
const RESOLUTION = 1024

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uBrightness;
  uniform float uWidth;
  uniform float uDust;
  uniform float uStars;
  uniform vec3 uNormal;
  uniform vec3 uCore;
  uniform vec3 uCool;
  uniform vec3 uWarm;
  varying vec3 vDirection;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 6; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    // Distance angulaire au plan galactique, et au bulbe dans ce plan.
    float height = dot(direction, uNormal);
    float coreAngle = acos(clamp(dot(direction, uCore), -1.0, 1.0));

    // Bande : profil gaussien, bords déchirés par le bruit.
    float clouds = fbm(direction * 3.0);
    float band = exp(-pow(height / (uWidth * (0.7 + 0.6 * clouds)), 2.0));
    float bulge = exp(-pow(coreAngle / 0.9, 2.0)) * exp(-pow(height / (uWidth * 1.6), 2.0));
    float glow = band * (0.35 + 0.65 * clouds) + bulge * 0.8;

    // Couloirs de poussière : filaments sombres resserrés au milieu de la bande.
    float lanes = smoothstep(0.48, 0.68, fbm(direction * 7.0 + vec3(4.0)));
    glow *= 1.0 - uDust * lanes * exp(-pow(height / (uWidth * 0.45), 2.0));

    vec3 color = mix(uCool, uWarm, clamp(bulge * 1.4, 0.0, 1.0)) * glow * uBrightness;

    // Poussière d'étoiles : points d'un texel, plus nombreux dans la bande.
    vec3 cell = floor(direction * 420.0);
    float star = hash(cell);
    float threshold = 1.0 - 0.012 * uStars * (0.35 + 1.5 * band);
    color += vec3(smoothstep(threshold, 1.0, star)) * uBrightness * 2.5 * (0.6 + 0.4 * hash(cell + 7.0));

    gl_FragColor = vec4(color, 1.0);
  }
`

export function createGalaxy(renderer, scene) {
  const settings = { ...GALAXY }
  const uniforms = {
    uBrightness: { value: 0 },
    uWidth: { value: 0 },
    uDust: { value: 0 },
    uStars: { value: 0 },
    uNormal: { value: new THREE.Vector3() },
    uCore: { value: new THREE.Vector3() },
    uCool: { value: new THREE.Color() },
    uWarm: { value: new THREE.Color() },
  }
  const skyScene = new THREE.Scene()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 64, 32),
    new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.BackSide, depthWrite: false }),
  )
  skyScene.add(sky)
  const target = new THREE.WebGLCubeRenderTarget(RESOLUTION, { type: THREE.HalfFloatType, generateMipmaps: false })
  const cubeCamera = new THREE.CubeCamera(1, 100, target)
  scene.background = target.texture

  // La galaxie arrive après coup (fichier de 9 Mo, décodé dans un worker) : le fond est recuit dès
  // qu'elle est prête, puis après chaque nouveau tri.
  let ready = false
  const pivot = new THREE.Group()
  skyScene.add(pivot)
  let placement = ''
  const splat = loadSplatGalaxy(`${import.meta.env.BASE_URL}${SPLAT_URL}`, { onSorted: () => bake() })
  splat.setResolution(RESOLUTION)
  pivot.add(splat.mesh)
  let radius = 1
  splat.loaded.then(({ center, radius: loadedRadius }) => {
    splat.mesh.position.copy(center).negate()
    radius = loadedRadius
    ready = true
    bake()
  }).catch((error) => console.error(error))

  function placeSplat() {
    const { splatSize, splatYaw, splatPitch, splatTilt, splatSpin } = settings
    pivot.position.set(
      Math.sin(splatYaw) * Math.cos(splatPitch),
      Math.sin(splatPitch),
      -Math.cos(splatYaw) * Math.cos(splatPitch),
    ).multiplyScalar(SPLAT_DISTANCE)
    // Les scènes 3DGS sont « y vers le bas » : demi-tour autour de x, puis inclinaison du disque.
    pivot.rotation.set(Math.PI + splatTilt, splatSpin, 0, 'YXZ')
    pivot.scale.setScalar(SPLAT_DISTANCE * Math.tan(THREE.MathUtils.degToRad(splatSize / 2)) / radius)
    // Le tri (le plus coûteux, dans le worker) n'est refait que si la galaxie a bougé ; la cuisson
    // suivante arrive avec onSorted.
    const key = [splatSize, splatYaw, splatPitch, splatTilt, splatSpin].join()
    if (key !== placement) {
      placement = key
      splat.requestSort()
    }
    const { uniforms: splatUniforms } = splat.mesh.material
    splatUniforms.uIntensity.value = settings.splatIntensity
    splatUniforms.uTint.value.set(settings.splatTint)
  }

  function bake() {
    uniforms.uBrightness.value = settings.brightness
    uniforms.uWidth.value = settings.width
    uniforms.uDust.value = settings.dust
    uniforms.uStars.value = settings.stars
    uniforms.uCool.value.set(settings.cool)
    uniforms.uWarm.value.set(settings.warm)
    // Plan de la bande : il passe un peu au-dessus de l'axe du couloir (-z) et penche de tilt.
    const normal = uniforms.uNormal.value.set(-Math.sin(settings.tilt), Math.cos(settings.tilt), 0)
    normal.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.25).normalize()
    // Bulbe : dans le plan, en avant et sur le côté.
    const core = uniforms.uCore.value.set(-0.6, 0, -1)
    core.addScaledVector(normal, -core.dot(normal)).normalize()
    if (ready) placeSplat()
    cubeCamera.update(renderer, skyScene)
  }
  bake()

  return {
    settings,
    bake,
    dispose() {
      splat.dispose()
      target.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
    },
  }
}
