import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const errorButton = document.querySelector('.error-code')
const errorSound = new Audio(`${import.meta.env.BASE_URL}error_sound.mp3`)
errorSound.preload = 'auto'

function playErrorSound() {
  errorSound.currentTime = 0
  errorSound.play().catch((error) => {
    if (error.name !== 'AbortError') console.warn('Impossible de lire le son d’erreur.', error)
  })
}

errorButton.addEventListener('click', playErrorSound)

const app = document.querySelector('#app')
const scene = new THREE.Scene()
scene.background = new THREE.Color('#050508')

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.domElement.setAttribute('role', 'img')
renderer.domElement.setAttribute('aria-label', 'Lune en 3D avec sa surface texturée')
app.append(renderer.domElement)

// Une géométrie commune, avec une taille et une texture propres à chaque astre.
const textureLoader = new THREE.TextureLoader()
const geometry = new THREE.SphereGeometry(1, 64, 64)
const planets = [
  { name: 'Lune', file: 'lune_texture.jpg', radius: 1, position: [0, 0, 0], speed: 0.08 },
  { name: 'Mars', file: 'mars_texture.jpg', radius: 1.4, position: [-5, 2, -4], speed: 0.06 },
  { name: 'Vénus', file: 'venus_texture.jpg', radius: 2, position: [5, 1, -7], speed: 0.025 },
  { name: 'Planète fictive', file: 'fiction1_texture.jpg', radius: 0.7, position: [2, -3, 2], speed: 0.1 },
].map(({ name, file, radius, position, speed }) => {
  const texture = textureLoader.load(`${import.meta.env.BASE_URL}${file}`)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.scale.setScalar(radius)
  mesh.position.set(...position)
  scene.add(mesh)
  return { mesh, material, texture, speed }
})

const bounds = new THREE.Box3()
for (const { mesh } of planets) bounds.expandByObject(mesh)
const framingSphere = bounds.getBoundingSphere(new THREE.Sphere())

// Un petit disque blanc partagé par les étoiles pour obtenir des points ronds.
const starCanvas = document.createElement('canvas')
starCanvas.width = starCanvas.height = 32
const starContext = starCanvas.getContext('2d')
starContext.fillStyle = '#ffffff'
starContext.beginPath()
starContext.arc(16, 16, 14, 0, Math.PI * 2)
starContext.fill()
const starTexture = new THREE.CanvasTexture(starCanvas)
starTexture.colorSpace = THREE.SRGBColorSpace

// Trois lots suffisent pour dessiner toutes les étoiles, sans objet par point.
// Chaque lot contient des étoiles proches et lointaines, fixes dans le monde 3D.
const starFields = [0.08, 0.16, 0.28].map((size) => {
  const positions = []
  const position = new THREE.Vector3()
  for (let i = 0; i < 1000; i++) {
    const nearby = i < 150
    const spread = nearby ? 35 : 200
    do {
      position.set(
        THREE.MathUtils.randFloatSpread(spread * 2),
        THREE.MathUtils.randFloatSpread(spread * 2),
        nearby ? THREE.MathUtils.randFloat(-35, 15) : THREE.MathUtils.randFloat(-250, -35),
      )
    } while (planets.some(({ mesh }) => position.distanceTo(mesh.position) < mesh.scale.x + 1))
    positions.push(position.x, position.y, position.z)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const starMaterial = new THREE.PointsMaterial({
    color: '#ffffff',
    size,
    map: starTexture,
    sizeAttenuation: true,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
    toneMapped: false,
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  scene.add(stars)
  return stars
})

// Un éclairage latéral révèle le volume de la sphère.
const soleil = new THREE.DirectionalLight('#fff5e6', 3)
soleil.position.set(-3, 2, 4)
scene.add(soleil)
scene.add(new THREE.AmbientLight('#ffffff', 0.15))

let cameraInitialized = false
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
  // Cadrer tous les astres au départ, puis conserver la position choisie.
  if (!cameraInitialized) {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const limitingFov = Math.atan(Math.tan(halfFov) * Math.min(camera.aspect, 1))
    camera.position.copy(framingSphere.center)
    camera.position.z += Math.min(framingSphere.radius * 1.1 / Math.sin(limitingFov), 200)
    cameraInitialized = true
  }
  camera.updateProjectionMatrix()
  if (pixelRatio !== nextPixelRatio) {
    pixelRatio = nextPixelRatio
    renderer.setPixelRatio(pixelRatio)
  }
  // Le CSS contrôle la taille affichée, Three.js uniquement la résolution.
  renderer.setSize(width, height, false)
}

const resizeObserver = new ResizeObserver(() => { resizePending = true })
resizeObserver.observe(app)
resize()

// Avec une caméra perspective, le zoom déplace réellement la caméra dans l'espace.
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableRotate = false
controls.enablePan = true
controls.screenSpacePanning = true
controls.mouseButtons.LEFT = THREE.MOUSE.PAN
controls.touches.ONE = THREE.TOUCH.PAN
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
controls.enableZoom = true
controls.zoomSpeed = 0.7
controls.zoomToCursor = true
controls.minDistance = 0.5
controls.maxDistance = 200
controls.target.copy(framingSphere.center)
controls.update()
renderer.domElement.setAttribute(
  'aria-label',
  'Quatre astres et un champ d’étoiles en 3D. Glissez pour déplacer la vue. Utilisez la molette ou pincez pour avancer ou reculer.',
)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
controls.enableDamping = !reducedMotion.matches
controls.dampingFactor = 0.12
let previousTime
renderer.setAnimationLoop((time) => {
  if (resizePending || pixelRatio !== Math.min(window.devicePixelRatio || 1, 1.5)) resize()
  const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05)
  previousTime = time
  if (!reducedMotion.matches) {
    for (const { mesh, speed } of planets) mesh.rotation.y += delta * speed
  }
  controls.update()
  renderer.render(scene, camera)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    errorButton.removeEventListener('click', playErrorSound)
    errorSound.pause()
    errorSound.removeAttribute('src')
    errorSound.load()
    resizeObserver.disconnect()
    renderer.setAnimationLoop(null)
    controls.dispose()
    geometry.dispose()
    for (const stars of starFields) {
      stars.geometry.dispose()
      stars.material.dispose()
    }
    starTexture.dispose()
    for (const { material, texture } of planets) {
      material.dispose()
      texture.dispose()
    }
    renderer.dispose()
    renderer.domElement.remove()
  })
}
