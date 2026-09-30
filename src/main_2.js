import './style.css'
import * as THREE from 'three'
import { createSun } from './space/sun.js'
import { createPlanets } from './space/planets.js'
import { createParticles } from './space/particles.js'
import { createNavigation } from './space/navigation.js'
import { createPostprocessing } from './space/postprocessing.js'
import { createDebugPane } from './space/debug.js'

const app = document.querySelector('#app')
const scene = new THREE.Scene()
// Noir pur, comme sur les clichés spatiaux : l'exposition calée sur les astres masque les étoiles.
scene.background = new THREE.Color('#000000')

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1200)
// Point de vue proche des premiers astres pour conserver la profondeur.
camera.position.set(0, 0, 18)

// L'antialiasing est fait par le rendu intermédiaire du post-traitement.
const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.outputColorSpace = THREE.SRGBColorSpace
// Ombres franches : pas de filtrage doux, pour un terminateur net.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.domElement.setAttribute('role', 'img')
renderer.domElement.setAttribute(
  'aria-label',
  'Huit planètes, leurs satellites et leurs atmosphères, dans un champ de particules en 3D. Glissez pour déplacer la vue. Utilisez la molette ou pincez pour avancer ou reculer.',
)
app.append(renderer.domElement)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const sun = createSun(scene)
const planets = createPlanets({ scene, renderer, sun })
const particles = createParticles(scene, planets.planets)
const navigation = createNavigation({ camera, domElement: renderer.domElement, app, reducedMotion })
const postprocessing = createPostprocessing(renderer, scene, camera)
const debugPane = createDebugPane(postprocessing.bloom, planets.reliefMaterials)

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
  camera.aspect = width / height
  // Garder un angle de 45° sur le petit côté sans déplacer la caméra.
  const baseHalfFov = THREE.MathUtils.degToRad(45 / 2)
  camera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(baseHalfFov) / Math.min(camera.aspect, 1)),
  )
  camera.updateProjectionMatrix()
  if (pixelRatio !== nextPixelRatio) {
    pixelRatio = nextPixelRatio
    renderer.setPixelRatio(pixelRatio)
  }
  // Le CSS contrôle la taille affichée, Three.js uniquement la résolution.
  renderer.setSize(width, height, false)
  postprocessing.setSize(width, height, pixelRatio)
}

const resizeObserver = new ResizeObserver(() => { resizePending = true })
resizeObserver.observe(app)
resize()

let previousTime
renderer.setAnimationLoop((time) => {
  if (resizePending || pixelRatio !== Math.min(window.devicePixelRatio || 1, 1.5)) resize()
  const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05)
  previousTime = time
  navigation.update(delta)
  planets.update(reducedMotion.matches ? 0 : delta, camera)
  sun.follow(camera)
  postprocessing.render(delta)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resizeObserver.disconnect()
    renderer.setAnimationLoop(null)
    debugPane.dispose()
    navigation.dispose()
    postprocessing.dispose()
    particles.dispose()
    planets.dispose()
    sun.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  })
}
