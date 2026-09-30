import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

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

// Un éclairage latéral révèle le volume de la sphère.
const soleil = new THREE.DirectionalLight('#fff5e6', 3)
soleil.position.set(-3, 2, 4)
scene.add(soleil)
scene.add(new THREE.AmbientLight('#ffffff', 0.15))

let cameraInitialized = false

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  // Cadrer tous les astres au départ, puis conserver la position choisie.
  if (!cameraInitialized) {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const limitingFov = Math.atan(Math.tan(halfFov) * Math.min(camera.aspect, 1))
    camera.position.copy(framingSphere.center)
    camera.position.z += Math.min(framingSphere.radius * 1.1 / Math.sin(limitingFov), 200)
    cameraInitialized = true
  }
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
}

window.addEventListener('resize', resize)
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
  'Quatre astres en 3D. Glissez pour déplacer la vue. Utilisez la molette ou pincez pour avancer ou reculer.',
)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let previousTime
renderer.setAnimationLoop((time) => {
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
    window.removeEventListener('resize', resize)
    renderer.setAnimationLoop(null)
    controls.dispose()
    geometry.dispose()
    for (const { material, texture } of planets) {
      material.dispose()
      texture.dispose()
    }
    renderer.dispose()
    renderer.domElement.remove()
  })
}
