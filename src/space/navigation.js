import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// Le glisser conserve le déplacement latéral ; la molette avance dans le couloir.
export function createNavigation({ camera, domElement, app, reducedMotion }) {
  const controls = new OrbitControls(camera, domElement)
  controls.enableRotate = false
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN
  controls.touches.ONE = THREE.TOUCH.PAN
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
  controls.enableZoom = false
  controls.enableDamping = !reducedMotion.matches
  controls.dampingFactor = 0.12
  controls.target.set(0, 0, 0)
  controls.update()

  // Caméra et cible avancent ensemble : aucune butée autour d'un centre d'orbite.
  const homeZ = camera.position.z
  let targetZ = homeZ
  // Vitesse constante (unités/s) et avance maximale de la cible sur la caméra :
  // la molette reste proportionnelle et la caméra s'arrête dès qu'on la lâche.
  const travelSpeed = 30
  const maxLead = 12
  const events = new AbortController()
  const options = { signal: events.signal }
  function advance(distance) {
    const lead = THREE.MathUtils.clamp(targetZ - distance - camera.position.z, -maxLead, maxLead)
    targetZ = THREE.MathUtils.clamp(camera.position.z + lead, -870, 24)
  }

  domElement.addEventListener('wheel', (event) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? app.clientHeight : 1
    advance(THREE.MathUtils.clamp(event.deltaY * unit, -100, 100) * 0.04)
  }, { ...options, passive: false })

  const touchPoints = new Map()
  let pinchDistance = null
  domElement.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))
      pinchDistance = touchPoints.size === 2
        ? [...touchPoints.values()][0].distanceTo([...touchPoints.values()][1]) : null
    }
  }, options)
  domElement.addEventListener('pointermove', (event) => {
    if (!touchPoints.has(event.pointerId)) return
    touchPoints.get(event.pointerId).set(event.clientX, event.clientY)
    if (touchPoints.size !== 2) return
    const [first, second] = [...touchPoints.values()]
    const distance = first.distanceTo(second)
    if (pinchDistance !== null) advance((distance - pinchDistance) * 0.1)
    pinchDistance = distance
  }, options)
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    domElement.addEventListener(eventName, (event) => {
      touchPoints.delete(event.pointerId)
      pinchDistance = null
    }, options)
  }

  return {
    // Retour au point de départ : centre de la vue et position initiale de la caméra.
    home() {
      targetZ = homeZ
      camera.position.set(0, 0, homeZ)
      controls.target.set(0, 0, 0)
      controls.update()
    },
    update(delta) {
      const previousZ = camera.position.z
      if (reducedMotion.matches) {
        camera.position.z = targetZ
      } else {
        // Déplacement linéaire : vitesse constante jusqu'à la cible, sans accélération.
        const offset = targetZ - camera.position.z
        const step = travelSpeed * delta
        camera.position.z = Math.abs(offset) <= step ? targetZ : camera.position.z + Math.sign(offset) * step
      }
      controls.target.z += camera.position.z - previousZ
      controls.update()
    },
    dispose() {
      events.abort()
      controls.dispose()
    },
  }
}
