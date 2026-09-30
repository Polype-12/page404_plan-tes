import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createSun } from './space/sun.js'
import { createPlanets } from './space/planets.js'
import { createParticles } from './space/particles.js'
import { createNavigation } from './space/navigation.js'
import { createPostprocessing } from './space/postprocessing.js'
import { createDebugPane } from './space/debug.js'
import { createPortal } from './portal/portal.js'

const app = document.querySelector('#app')
const homeButton = document.querySelector('#home')

// Distances de la caméra du « 404 » : départ, début et fin du fondu vers l'espace.
const PORTAL_DISTANCE = 16
const ENTER_START = 7.5
const ENTER_END = 3.6
// Profondeur dont la caméra de l'espace avance pendant l'entrée, et amplitude de la parallaxe.
const DIVE = 9
const PARALLAX = 4
const HOME_DURATION = 1.6
const SPACE_HOME_Z = 18

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
// Ombres franches : pas de filtrage doux, pour un terminateur net.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.domElement.setAttribute('role', 'img')
renderer.domElement.setAttribute(
  'aria-label',
  'Le nombre 404 en verre, fenêtre sur un espace peuplé de planètes. Glissez pour tourner autour, utilisez la molette ou pincez pour zoomer et entrer dans l\'espace.',
)
app.append(renderer.domElement)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Espace : rendu dans une texture, vue à travers le verre puis plein écran.
const spaceScene = new THREE.Scene()
spaceScene.background = new THREE.Color('#000000')
const spaceCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 1200)
spaceCamera.position.set(0, 0, SPACE_HOME_Z)
const sun = createSun(spaceScene)
const planets = createPlanets({ scene: spaceScene, renderer, sun })
const particles = createParticles(spaceScene, planets.planets)
const navigation = createNavigation({ camera: spaceCamera, domElement: renderer.domElement, app, reducedMotion })
navigation.setEnabled(false)
const postprocessing = createPostprocessing(renderer, spaceScene, spaceCamera, { toScreen: false })
const debugPane = createDebugPane(postprocessing.bloom, planets.reliefMaterials)

// Portail : le « 404 » en verre, que l'on contourne et dans lequel on zoome.
const portalCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
portalCamera.position.set(0, 0, PORTAL_DISTANCE)
const portal = createPortal({ renderer, camera: portalCamera, getSpaceTexture: () => postprocessing.texture })
const portalControls = new OrbitControls(portalCamera, renderer.domElement)
portalControls.enablePan = false
portalControls.enableDamping = !reducedMotion.matches
portalControls.dampingFactor = 0.06
portalControls.rotateSpeed = 0.5
portalControls.zoomSpeed = 0.8
portalControls.minDistance = 3
portalControls.maxDistance = 28
// Vue de face, toujours lisible : le tour du « 404 » reste limité.
portalControls.minAzimuthAngle = -1
portalControls.maxAzimuthAngle = 1
portalControls.minPolarAngle = Math.PI / 2 - 0.55
portalControls.maxPolarAngle = Math.PI / 2 + 0.55

let mode = 'portal'
// Avancement (0 à 1) du retour à la vue de départ du « 404 » ; null hors animation.
let homing = null
const homingFrom = new THREE.Vector3()
const homeView = new THREE.Vector3(0, 0, PORTAL_DISTANCE)

// Depuis l'espace ou depuis un zoom/tour du « 404 » : retour à la vue de face de départ.
function goHome() {
  if (homing !== null) return
  if (mode === 'space') {
    mode = 'portal'
    navigation.setEnabled(false)
    homingFrom.set(0, 0, ENTER_END)
  } else {
    homingFrom.copy(portalCamera.position)
  }
  homing = 0
  portalControls.enabled = false
  portalControls.target.set(0, 0, 0)
  portalCamera.position.copy(homingFrom)
}
homeButton.addEventListener('click', goHome)

function enterSpace() {
  mode = 'space'
  portalControls.enabled = false
  // La caméra de l'espace est déjà à cet endroit : aucune coupure visible.
  navigation.reset(SPACE_HOME_Z - DIVE)
  navigation.setEnabled(true)
}

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
  applyFov(spaceCamera, 45, width / height)
  applyFov(portalCamera, 50, width / height)
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

// 0 = « 404 » entier, 1 = plongée terminée ; progression douce entre les deux distances.
function enterProgress(distance) {
  const t = THREE.MathUtils.clamp((ENTER_START - distance) / (ENTER_START - ENTER_END), 0, 1)
  return t * t * (3 - 2 * t)
}

let previousTime
renderer.setAnimationLoop((time) => {
  if (resizePending || pixelRatio !== Math.min(window.devicePixelRatio || 1, 1.5)) resize()
  const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05)
  previousTime = time

  if (homing !== null) {
    homing = Math.min(homing + delta / HOME_DURATION, 1)
    const eased = homing < 0.5 ? 4 * homing ** 3 : 1 - (-2 * homing + 2) ** 3 / 2
    portalCamera.position.lerpVectors(homingFrom, homeView, eased)
    if (homing === 1) {
      homing = null
      portalControls.enabled = true
    }
  }

  let enter = 1
  if (mode === 'portal') {
    portalControls.update()
    enter = enterProgress(portalCamera.position.distanceTo(portalControls.target))
    if (homing === null && enter >= 1) {
      enterSpace()
    } else {
      // La caméra de l'espace suit la plongée ; la parallaxe donne de la profondeur à la fenêtre.
      const fade = 1 - enter
      const z = SPACE_HOME_Z - DIVE * enter
      spaceCamera.position.set(
        -portalControls.getAzimuthalAngle() * PARALLAX * fade,
        (portalControls.getPolarAngle() - Math.PI / 2) * PARALLAX * fade,
        z,
      )
      spaceCamera.lookAt(0, 0, z - 30)
    }
  }
  if (mode === 'space') navigation.update(delta)

  planets.update(reducedMotion.matches ? 0 : delta, spaceCamera)
  particles.update(spaceCamera)
  sun.follow(spaceCamera)
  postprocessing.render(delta)
  portal.render(enter, time / 1000, reducedMotion.matches ? 0 : 1)
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
