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
  let targetZ = camera.position.z
  let travelVelocity = 0
  const events = new AbortController()
  const options = { signal: events.signal }
  function advance(distance) {
    targetZ = THREE.MathUtils.clamp(targetZ - distance, -650, 24)
  }

  domElement.addEventListener('wheel', (event) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? app.clientHeight : 1
    advance(THREE.MathUtils.clamp(event.deltaY * unit, -160, 160) * 0.18)
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
    if (pinchDistance !== null) advance((distance - pinchDistance) * 0.35)
    pinchDistance = distance
  }, options)
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    domElement.addEventListener(eventName, (event) => {
      touchPoints.delete(event.pointerId)
      pinchDistance = null
    }, options)
  }

  return {
    update(delta) {
      const previousZ = camera.position.z
      if (reducedMotion.matches) {
        camera.position.z = targetZ
        travelVelocity = 0
      } else {
        // Ressort amorti analytique : départ progressif, mouvement rapide, arrêt sans rebond.
        const frequency = 10
        const offset = camera.position.z - targetZ
        const impulse = travelVelocity + frequency * offset
        const decay = Math.exp(-frequency * delta)
        camera.position.z = targetZ + (offset + impulse * delta) * decay
        travelVelocity = (travelVelocity - frequency * impulse * delta) * decay
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
