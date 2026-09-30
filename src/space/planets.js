import * as THREE from 'three'
import { createAtmosphere, updateAtmosphereSides } from './atmosphere.js'

// Positions [x, y, z] : plus z est négatif, plus l'astre est loin au départ.
// Un couloir dégagé, avec des rencontres espacées sur 600 unités de profondeur.
// atmosphere : options de createAtmosphere. satellites : distance au centre, en unités du monde.
export const PLANETS = [
  { name: 'Lune', file: 'lune_texture.jpg', radius: 0.8, position: [-2.7, 1.5, 5] },
  {
    name: 'Planète fictive', file: 'fiction1_texture.jpg', radius: 1.3, position: [5, -2, -45],
    atmosphere: { color: '#9fd0ff', intensity: 0.9 },
  },
  {
    name: 'Vénus', file: 'venus_texture.jpg', radius: 5, position: [-9, -3, -115],
    atmosphere: { color: '#ffe2a8', intensity: 1.2, thickness: 0.07, density: 2.5, mie: 2 },
  },
  {
    name: 'Jupiter', file: 'jupiter_texture.jpg', radius: 22, position: [29, 8, -200],
    atmosphere: { color: '#b4ccff', intensity: 0.7, thickness: 0.025 },
    satellites: [
      { name: 'Io', file: 'fictional3_texture.png', radius: 1.2, distance: 32 },
      { name: 'Europe', file: 'fiction1_texture.jpg', radius: 1, distance: 40 },
      { name: 'Ganymède', file: 'fictional4_texture.png', radius: 1.7, distance: 50 },
      { name: 'Callisto', file: 'fictif2_texture.jpg', radius: 1.5, distance: 62 },
    ],
  },
  {
    name: 'Mars', file: 'mars_texture.jpg', radius: 2, position: [-6, 3, -295],
    atmosphere: { color: '#f0c49a', intensity: 0.6, thickness: 0.035, density: 0.5, mie: 3 },
    satellites: [
      { name: 'Phobos', file: 'fictional4_texture.png', radius: 0.22, distance: 3.4 },
      { name: 'Deimos', file: 'fictional3_texture.png', radius: 0.15, distance: 5.5 },
    ],
  },
  {
    name: 'Planète fictive 3', file: 'fictional3_texture.png', radius: 10, position: [16, -6, -395],
    atmosphere: { color: '#8fffe0', intensity: 1 },
  },
  {
    name: 'Planète fictive 2', file: 'fictif2_texture.jpg', radius: 32, position: [-41, 10, -500],
    atmosphere: { color: '#ffb890', intensity: 0.9, thickness: 0.04 },
    satellites: [
      { name: 'Satellite fictif A', file: 'fictional4_texture.png', radius: 2.2, distance: 48 },
      { name: 'Satellite fictif B', file: 'fiction1_texture.jpg', radius: 1.4, distance: 60 },
    ],
  },
  {
    name: 'Planète fictive 4', file: 'fictional4_texture.png', radius: 3, position: [8, -3, -610],
    atmosphere: { color: '#c8a8ff', intensity: 0.8 },
  },
]

export function createPlanets({ scene, renderer, sun }) {
  // Une géométrie commune, avec une taille et une texture propres à chaque astre.
  const geometry = new THREE.SphereGeometry(1, 64, 64)
  const textureLoader = new THREE.TextureLoader()
  const materials = []
  const atmospheres = []
  const orbits = []

  function createBody({ name, file, radius, atmosphere }) {
    const texture = textureLoader.load(`${import.meta.env.BASE_URL}${file}`)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
    materials.push(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.scale.setScalar(radius)
    // Rotation propre de départ aléatoire.
    mesh.rotation.y = Math.random() * Math.PI * 2
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (atmosphere) {
      const shell = createAtmosphere(geometry, sun.uniforms, atmosphere)
      atmospheres.push(shell)
      mesh.add(shell)
    }
    return mesh
  }

  const planets = PLANETS.map(({ position, satellites = [], ...body }) => {
    // Le système porte l'inclinaison aléatoire de l'axe, partagée par le plan orbital des satellites.
    const system = new THREE.Group()
    system.position.set(...position)
    system.rotation.set(THREE.MathUtils.randFloatSpread(0.8), 0, THREE.MathUtils.randFloatSpread(0.8))
    system.add(createBody(body))
    for (const satellite of satellites) {
      const orbit = new THREE.Group()
      orbit.rotation.y = Math.random() * Math.PI * 2
      const mesh = createBody(satellite)
      mesh.position.x = satellite.distance
      orbit.add(mesh)
      system.add(orbit)
      // Troisième loi de Kepler : les satellites lointains tournent plus lentement.
      orbits.push({ orbit, speed: 0.15 * Math.pow(body.radius / satellite.distance, 1.5) })
    }
    scene.add(system)
    return { center: system.position, radius: body.radius }
  })

  return {
    planets,
    update(delta, camera) {
      for (const { orbit, speed } of orbits) orbit.rotation.y += speed * delta
      updateAtmosphereSides(atmospheres, camera)
    },
    dispose() {
      geometry.dispose()
      for (const material of materials) {
        material.map.dispose()
        material.dispose()
      }
      for (const atmosphere of atmospheres) atmosphere.material.dispose()
    },
  }
}
