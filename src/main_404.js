import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createSun } from './space/sun.js'
import { createPlanets } from './space/planets.js'
import { createParticles } from './space/particles.js'
import { createNavigation } from './space/navigation.js'
import { createPostprocessing } from './space/postprocessing.js'
import { createFog } from './space/fog.js'
import { createDebugPane } from './space/debug.js'
import { createPortal } from './portal/portal.js'

const app = document.querySelector('#app')
const homeButton = document.querySelector('#home')

// Le plan de la fenêtre (face avant du « 404 ») correspond à la profondeur SPACE_HOME_Z de l'espace :
// la caméra de l'espace est la caméra du portail, décalée en z. Rien de l'espace ne dépasse ce plan.
const SPACE_HOME_Z = 18
const FOV = 45
const PORTAL_DISTANCE = 16
// Le zoom d'OrbitControls (distance au centre du « 404 ») pilote la plongée : dès le premier cran de
// molette, de STEER_START (la vue de départ) à STEER_END, la caméra suit une courbe douce jusqu'à ENTER devant un jambage du « 0 », de face, puis
// passe dans l'espace. CURVE_HANDLE : longueur des tangentes de la courbe (fraction de STEER_START).
// EXIT : en reculant dans l'espace, distance au plan de la fenêtre à laquelle on retrouve le « 404 ».
const STEER_START = PORTAL_DISTANCE
const STEER_END = 2.5
const CURVE_HANDLE = 0.45
const ENTER = 0.3
const EXIT = 0.35
const HOME_DURATION = 1.6
// Avancement de la plongée au-delà duquel le bouton « Retour » disparaît.
const HIDE_BUTTON = 0.6

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
// Ombres franches : pas de filtrage doux, pour un terminateur net.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.domElement.setAttribute('role', 'img')
renderer.domElement.setAttribute(
  'aria-label',
  'Le nombre 404 en verre, fenêtre sur un espace brumeux peuplé de planètes. Glissez pour tourner autour, utilisez la molette ou pincez pour entrer dans l\'espace et y avancer.',
)
app.append(renderer.domElement)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Espace : toujours rendu dans une texture, vue à travers les chiffres puis plein écran.
const spaceScene = new THREE.Scene()
const fog = createFog(spaceScene)
const spaceCamera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 1200)
spaceCamera.position.set(0, 0, SPACE_HOME_Z)
const sun = createSun(spaceScene)
const planets = createPlanets({ scene: spaceScene, renderer, sun })
const particles = createParticles(spaceScene, planets.planets)
const navigation = createNavigation({ camera: spaceCamera, domElement: renderer.domElement, app, reducedMotion })
navigation.setEnabled(false)
const postprocessing = createPostprocessing(renderer, spaceScene, spaceCamera, { toScreen: false })
// Vu depuis le portail, l'espace s'arrête au plan de la fenêtre (garde z <= SPACE_HOME_Z).
const windowClip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), SPACE_HOME_Z)]

// Portail : le « 404 » en verre, que l'on contourne et dans lequel on zoome.
const portalCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
portalCamera.position.set(0, 0, PORTAL_DISTANCE)
const portal = createPortal({ renderer, camera: portalCamera, getSpaceTexture: () => postprocessing.texture })
const debugPane = createDebugPane(postprocessing.bloom, planets.reliefMaterials, fog, portal.glass)
const spaceOffset = SPACE_HOME_Z - portal.frontZ
// OrbitControls déplace une caméra témoin, toujours tournée vers le centre ; la caméra rendue la copie
// au loin, puis s'en écarte le long de la courbe de plongée (voir placePortalCamera).
const orbitCamera = new THREE.PerspectiveCamera()
orbitCamera.position.copy(portalCamera.position)
const portalControls = new OrbitControls(orbitCamera, renderer.domElement)
portalControls.enablePan = false
portalControls.enableDamping = !reducedMotion.matches
portalControls.dampingFactor = 0.06
portalControls.rotateSpeed = 0.5
portalControls.zoomSpeed = 1.2
portalControls.minDistance = STEER_END * 0.9
// Pas de recul au-delà de la vue de départ : tout zoom avant est une plongée.
portalControls.maxDistance = STEER_START
// Vue de face, toujours lisible : le tour du « 404 » reste limité.
portalControls.minAzimuthAngle = -1
portalControls.maxAzimuthAngle = 1
portalControls.minPolarAngle = Math.PI / 2 - 0.55
// Vers le bas, juste un peu sous l'horizontale : la caméra reste au-dessus du sol.
portalControls.maxPolarAngle = Math.PI / 2 + Math.asin(Math.min(1, (-portal.bottomY - 0.6) / PORTAL_DISTANCE))

let mode = 'portal'
// Avancement de la plongée (0 à 1), d'après placePortalCamera.
let dive = 0
const center = new THREE.Vector3()
// Point de sortie de l'espace (après un glissé latéral) : la courbe y mène au lieu du jambage du « 0 ».
let exitPoint = null
const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3())
const direction = new THREE.Vector3()
const entry = new THREE.Vector3()
const lookTarget = new THREE.Vector3()

// Depuis l'espace ou un zoom/tour du « 404 » : retour animé à la vue de face de départ.
let homing = null
const homingFrom = new THREE.Vector3()
const homeView = new THREE.Vector3(0, 0, PORTAL_DISTANCE)

// Place la caméra rendue d'après la caméra témoin ; renvoie l'avancement de la plongée (0 à 1).
function placePortalCamera() {
  const distance = orbitCamera.position.distanceTo(center)
  // Tolérance : la butée de maxDistance ne retombe pas toujours exactement sur STEER_START.
  if (distance >= STEER_START - 1e-3) {
    exitPoint = null
    portalControls.enableRotate = true
    portalCamera.position.copy(orbitCamera.position)
    portalCamera.quaternion.copy(orbitCamera.quaternion)
    return 0
  }
  // Pendant la plongée, la direction d'approche reste figée.
  portalControls.enableRotate = false
  // Le zoom est exponentiel : l'avancement en logarithme garde une vitesse régulière à la molette.
  const progress = THREE.MathUtils.clamp(Math.log(STEER_START / distance) / Math.log(STEER_START / STEER_END), 0, 1)
  direction.subVectors(orbitCamera.position, center).normalize()
  // Le jambage du côté où l'on se trouve : la caméra n'a pas à traverser le « 0 ».
  if (exitPoint) entry.copy(exitPoint)
  else entry.set((direction.x < 0 ? -1 : 1) * portal.entryX, 0, portal.frontZ)
  // Départ dans le prolongement du zoom, arrivée de face : tangentes continues aux deux bouts.
  const { v0, v1, v2, v3 } = curve
  v0.copy(center).addScaledVector(direction, STEER_START)
  v1.copy(v0).addScaledVector(direction, -STEER_START * CURVE_HANDLE)
  v3.set(entry.x, entry.y, entry.z + ENTER)
  v2.set(v3.x, v3.y, v3.z + STEER_START * CURVE_HANDLE)
  curve.getPoint(progress, portalCamera.position)
  // Le regard passe en douceur du centre du « 404 » au point d'entrée.
  lookTarget.lerpVectors(center, entry, THREE.MathUtils.smoothstep(progress, 0, 1))
  portalCamera.lookAt(lookTarget)
  return progress
}

function enterSpace() {
  mode = 'space'
  portalControls.enabled = false
  const { x, y, z } = portalCamera.position
  navigation.reset(z + spaceOffset, x, y)
  navigation.setEnabled(true)
}

function exitSpace() {
  mode = 'portal'
  navigation.setEnabled(false)
  const { x, y } = spaceCamera.position
  // La courbe reprend presque à son terme, vers le point où l'on ressort.
  exitPoint = new THREE.Vector3(x, y, portal.frontZ)
  direction.subVectors(orbitCamera.position, center).normalize()
  orbitCamera.position.copy(center).addScaledVector(direction, STEER_END * 1.04)
  orbitCamera.lookAt(center)
  portalControls.enabled = true
}

function goHome() {
  if (homing !== null) return
  if (mode === 'space') exitSpace()
  homing = 0
  portalControls.enabled = false
  homingFrom.copy(orbitCamera.position)
}
homeButton.addEventListener('click', goHome)

// Garder un angle de base sur le petit côté sans déplacer la caméra.
function applyFov(camera, baseFov, aspect) {
  camera.aspect = aspect
  const baseHalfFov = THREE.MathUtils.degToRad(baseFov / 2)
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(baseHalfFov) / Math.min(aspect, 1)))
  camera.updateProjectionMatrix()
}

let resizePending = true
let renderWidth = 0
let renderHeight = 0
let pixelRatio = 0

function resize() {
  resizePending = false
  const width = Math.max(1, app.clientWidth)
  const height = Math.max(1, app.clientHeight)
  const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  if (width === renderWidth && height === renderHeight && pixelRatio === nextPixelRatio) return
  renderWidth = width
  renderHeight = height
  applyFov(spaceCamera, FOV, width / height)
  applyFov(portalCamera, FOV, width / height)
  if (pixelRatio !== nextPixelRatio) {
    pixelRatio = nextPixelRatio
    renderer.setPixelRatio(pixelRatio)
  }
  // Le CSS contrôle la taille affichée, Three.js uniquement la résolution.
  renderer.setSize(width, height, false)
  postprocessing.setSize(width, height, pixelRatio)
  portal.setSize()
}

const resizeObserver = new ResizeObserver(() => { resizePending = true })
resizeObserver.observe(app)
resize()

let previousTime
renderer.setAnimationLoop((time) => {
  if (resizePending || pixelRatio !== Math.min(window.devicePixelRatio || 1, 1.5)) resize()
  const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05)
  previousTime = time

  if (homing !== null) {
    homing = Math.min(homing + delta / HOME_DURATION, 1)
    const eased = homing < 0.5 ? 4 * homing ** 3 : 1 - (-2 * homing + 2) ** 3 / 2
    // La caméra témoin recule : la caméra rendue refait la courbe à l'envers.
    orbitCamera.position.lerpVectors(homingFrom, homeView, eased)
    orbitCamera.lookAt(center)
    if (homing === 1) {
      homing = null
      portalControls.enabled = true
    }
  } else if (mode === 'portal') {
    portalControls.update()
  }

  if (mode === 'portal') dive = placePortalCamera()
  if (mode === 'portal' && dive >= 1 && homing === null) enterSpace()
  if (mode === 'space') {
    navigation.update(delta)
    if (spaceCamera.position.z > SPACE_HOME_Z + EXIT) {
      exitSpace()
      dive = placePortalCamera()
    }
  }
  if (mode === 'portal') {
    // La caméra de l'espace suit exactement celle du portail, décalée en profondeur.
    spaceCamera.position.copy(portalCamera.position)
    spaceCamera.position.z += spaceOffset
    spaceCamera.quaternion.copy(portalCamera.quaternion)
  }

  planets.update(reducedMotion.matches ? 0 : delta, spaceCamera)
  particles.update(spaceCamera, reducedMotion.matches ? 0 : time / 1000)
  sun.follow(spaceCamera)
  renderer.clippingPlanes = mode === 'portal' ? windowClip : []
  postprocessing.render(delta)
  renderer.clippingPlanes = []
  portal.render(mode === 'space', dive)
  // Le bouton n'a de sens que devant le « 404 » sur fond blanc.
  homeButton.classList.toggle('is-hidden', mode === 'space' || dive > HIDE_BUTTON)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resizeObserver.disconnect()
    homeButton.removeEventListener('click', goHome)
    renderer.setAnimationLoop(null)
    debugPane.dispose()
    portalControls.dispose()
    portal.dispose()
    navigation.dispose()
    postprocessing.dispose()
    particles.dispose()
    planets.dispose()
    sun.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  })
}
