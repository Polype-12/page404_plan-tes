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
  let enabled = true
  // Vitesse maximale (unités/s), accélération (unités/s²) et avance maximale de la cible sur la
  // caméra : la molette reste proportionnelle, la caméra démarre et s'arrête en douceur.
  const maxSpeed = 50
  const acceleration = 100
  const maxLead = 18
  let velocity = 0
  const events = new AbortController()
  const options = { signal: events.signal }
  function advance(distance) {
    const lead = THREE.MathUtils.clamp(targetZ - distance - camera.position.z, -maxLead, maxLead)
    // Pas de butée vers l'avant : le décor se répète (voir planets.js et particles.js).
    targetZ = Math.min(camera.position.z + lead, 24)
  }

  domElement.addEventListener('wheel', (event) => {
    if (!enabled) return
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? app.clientHeight : 1
    // Même sens que OrbitControls (le 404) : molette vers le haut = avancer, vers le bas = reculer.
    advance(-THREE.MathUtils.clamp(event.deltaY * unit, -100, 100) * 0.06)
  }, { ...options, passive: false })

  const touchPoints = new Map()
  let pinchDistance = null
  domElement.addEventListener('pointerdown', (event) => {
    if (enabled && event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))
      pinchDistance = touchPoints.size === 2
        ? [...touchPoints.values()][0].distanceTo([...touchPoints.values()][1]) : null
    }
  }, options)
  domElement.addEventListener('pointermove', (event) => {
    if (!enabled || !touchPoints.has(event.pointerId)) return
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

  // Replace la caméra sur l'axe à la profondeur z, vue recentrée (par défaut : le point de départ).
  function reset(z = homeZ) {
    targetZ = z
    velocity = 0
    camera.position.set(0, 0, z)
    controls.target.set(0, 0, z - homeZ)
    controls.update()
  }

  return {
    reset,
    home: () => reset(),
    // Désactivé, la navigation ignore souris et doigts : un autre contrôle prend la main.
    setEnabled(value) {
      enabled = value
      controls.enabled = value
      if (!value) {
        touchPoints.clear()
        pinchDistance = null
      }
    },
    update(delta) {
      const previousZ = camera.position.z
      if (reducedMotion.matches) {
        camera.position.z = targetZ
        velocity = 0
      } else {
        // Profil trapézoïdal : accélération constante, vitesse de croisière, puis freinage calé pour
        // s'arrêter exactement sur la cible (la vitesse voulue suit la courbe de freinage).
        const offset = targetZ - camera.position.z
        const wanted = Math.sign(offset) * Math.min(maxSpeed, Math.sqrt(2 * acceleration * Math.abs(offset)))
        const maxChange = acceleration * delta
        velocity += THREE.MathUtils.clamp(wanted - velocity, -maxChange, maxChange)
        const step = velocity * delta
        if (Math.abs(offset) < 1e-3 || (Math.sign(step) === Math.sign(offset) && Math.abs(step) >= Math.abs(offset))) {
          camera.position.z = targetZ
          velocity = 0
        } else {
          camera.position.z += step
        }
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
