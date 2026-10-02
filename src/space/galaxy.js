import * as THREE from 'three'
import { loadSplatGalaxy } from './splat-galaxy.js'
import { LOOP_LENGTH } from './planets.js'

// Fond de l'espace : une seule bande galactique très sombre, vue par la tranche, qui traverse le ciel
// en biais. Nuages doux, couloirs de poussière plus sombres, bulbe un peu plus chaud d'un côté et
// poussière d'étoiles très fine. Tout est calculé par un shader une seule fois, dans une texture cube
// (refaite seulement quand un réglage change) : le fond ne coûte rien à chaque image et reste à
// l'infini, il ne bouge que lorsque la vue tourne.
// brightness : luminosité maximale de la bande (rester sous ~0.08 pour ne pas concurrencer les astres).
// tilt : inclinaison de la bande à l'écran (radians). width : épaisseur angulaire de la bande.
// dust : opacité des couloirs de poussière. stars : densité de la poussière d'étoiles.
// cool / warm : teintes de la bande et du bulbe.
// splat… / galaxy… : galaxie en gaussian splatting (splat-galaxy.js), vrai objet de l'espace dessiné à
// chaque image dans la même scène que les astres (profondeur et brouillard communs). splatFraction :
// part des splats dessinés (0 à 1, moins = plus léger). splatScale : facteur du rayon de chaque splat.
// splatRoundness : 0 = ellipses du fichier (traits), 1 = points ronds.
// splatIntensity :
// luminosité. galaxyX / galaxyY / galaxyZ : position dans le monde, au départ du couloir (droit devant
// = -z). Elle se répète avec le couloir, comme les astres (planets.js) : une fois dépassée, elle revient
// LOOP_LENGTH plus loin, inversée en x une fois sur deux. galaxyRadius : rayon. splatTilt / splatSpin :
// inclinaison et rotation du disque.
// splatTint : teinte multipliée aux couleurs du fichier.
export const GALAXY = {
  brightness: 0.005,
  tilt: 0.99,
  width: 0.29,
  dust: 0.67,
  stars: 0.7,
  cool: '#354467',
  warm: '#9aa3c2',
  galaxyX: -156,
  galaxyY: -20,
  galaxyZ: -404,
  galaxyRadius: 360,
  splatTilt: -0.07,
  splatSpin: 3.14,
  splatTint: '#f2f2f2',
  splatIntensity: 1.5,
  splatFraction: 0.43,
  splatScale: 0.4,
  splatRoundness: 0.87,
}
const SPLAT_URL = 'galaxy/galaxy.compressed.ply'
// Une fois dépassée, la galaxie est replacée devant, son centre à environ LOOP_LENGTH - rayon - 120 :
// bien plus près que les astres (trop grande pour aller plus loin sans être coupée par le plan
// lointain). Elle y est invisible, puis apparaît sur APPEAR_FADE unités d'avancée, comme sortie du
// brouillard. La première galaxie, celle du départ du couloir, est entière d'emblée.
const APPEAR_FADE = 400
const APPEAR_MARGIN = 120
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

  // La galaxie arrive après coup (fichier de 9 Mo, décodé dans un worker), dans l'espace lui-même.
  let ready = false
  const pivot = new THREE.Group()
  pivot.visible = false
  scene.add(pivot)
  const splat = loadSplatGalaxy(`${import.meta.env.BASE_URL}${SPLAT_URL}`)
  pivot.add(splat.mesh)
  let radius = 1
  splat.loaded.then(({ center, radius: loadedRadius }) => {
    splat.mesh.position.copy(center).negate()
    radius = loadedRadius
    ready = true
    pivot.visible = true
  }).catch((error) => console.error(error))

  // Nouveau tri quand la galaxie change de place, ou quand la caméra s'est assez déplacée par rapport
  // à elle (2 % de leur distance) : l'ordre des splats reste juste sans trier à chaque image.
  let placement = ''
  const sortedFrom = new THREE.Vector3(Infinity, 0, 0)
  const toCamera = new THREE.Vector3()
  const size = new THREE.Vector2()

  function update(camera) {
    if (!ready) return
    const { galaxyX, galaxyY, galaxyZ, galaxyRadius, splatTilt, splatSpin } = settings
    // Répétition du couloir : replacée devant une fois tout son disque passé derrière la caméra.
    const loop = Math.floor((camera.position.z + galaxyRadius + APPEAR_MARGIN - galaxyZ) / LOOP_LENGTH)
    pivot.position.set(loop % 2 ? -galaxyX : galaxyX, galaxyY, galaxyZ + loop * LOOP_LENGTH)
    // Distance à laquelle elle réapparaît (son centre, devant la caméra), puis fondu d'entrée.
    const appearAt = LOOP_LENGTH - galaxyRadius - APPEAR_MARGIN
    const ahead = camera.position.z - pivot.position.z
    const appear = 1 - THREE.MathUtils.smoothstep(ahead, appearAt - APPEAR_FADE, appearAt)
    splat.mesh.material.uniforms.uAppear.value = loop === 0 ? 1 : appear
    // Les scènes 3DGS sont « y vers le bas » : demi-tour autour de x, puis inclinaison du disque.
    pivot.rotation.set(Math.PI + splatTilt, splatSpin, 0, 'YXZ')
    pivot.scale.setScalar(galaxyRadius / radius)
    const { uniforms: splatUniforms } = splat.mesh.material
    splatUniforms.uIntensity.value = settings.splatIntensity
    splatUniforms.uTint.value.set(settings.splatTint)
    splatUniforms.uFraction.value = settings.splatFraction
    splatUniforms.uSplatScale.value = settings.splatScale
    splatUniforms.uRoundness.value = settings.splatRoundness
    renderer.getDrawingBufferSize(size)
    splat.setViewport(size.x, size.y, camera.fov)

    const key = [galaxyRadius, splatTilt, splatSpin].join()
    toCamera.subVectors(camera.position, pivot.position)
    if (key !== placement || toCamera.distanceTo(sortedFrom) > 0.02 * toCamera.length()) {
      placement = key
      sortedFrom.copy(toCamera)
      splat.requestSort(camera)
    }
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
    cubeCamera.update(renderer, skyScene)
  }
  bake()

  return {
    settings,
    bake,
    // À appeler à chaque image, avant le rendu de l'espace : place la galaxie et relance le tri.
    update,
    dispose() {
      splat.dispose()
      target.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
    },
  }
}
