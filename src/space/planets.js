import * as THREE from 'three'
import { createAtmosphere, updateAtmosphereSides } from './atmosphere.js'

// Positions [x, y, z] : plus z est négatif, plus l'astre est loin au départ.
// Un couloir dégagé, avec des rencontres espacées sur 800 unités de profondeur.
// atmosphere : options de createAtmosphere. satellites : distance au centre, en unités du monde.
// normalMap : fichier de public/normal_maps. normalScale : intensité du relief, calibrée
// pour que chaque carte donne une inclinaison moyenne comparable (réglable dans le panneau).
export const PLANETS = [
  { name: 'Lune', file: 'lune_texture.jpg', normalMap: 'lune_map.jpg', normalScale: 0.4, radius: 0.8, position: [-2.7, 1.5, 5] },
  {
    // fictional1_map.jpg est défectueuse (normales tournées vers l'intérieur) : pas de relief.
    name: 'Planète fictive', file: 'fiction1_texture.jpg', radius: 1.3, position: [5, -2, -45],
    atmosphere: { color: '#9fd0ff', intensity: 0.9 },
  },
  {
    // Couche nuageuse : relief discret.
    name: 'Vénus', file: 'venus_texture.jpg', normalMap: 'venus_map.jpg', normalScale: 1,
    radius: 5, position: [-9, -3, -115],
    atmosphere: { color: '#ffe2a8', intensity: 1.2, thickness: 0.07, density: 2.5, mie: 2 },
  },
  {
    // Géante gazeuse : bandes à peine modelées.
    name: 'Jupiter', file: 'jupiter_texture.jpg', normalMap: 'jupiter_map.jpg', normalScale: 0.3,
    radius: 22, position: [29, 8, -200],
    atmosphere: { color: '#b4ccff', intensity: 0.7, thickness: 0.025 },
    // Multiplicateur de la vitesse orbitale des satellites (1 par défaut).
    orbitSpeed: 0.1,
    satellites: [
      { name: 'Io', file: 'io_texture.jpg', normalMap: 'io_map.jpg', normalScale: 0.65, radius: 1.2, distance: 32 },
      { name: 'Europe', file: 'europa_texture.jpg', normalMap: 'europa_map.jpg', normalScale: 0.25, radius: 1, distance: 40 },
      { name: 'Ganymède', file: 'ganymede_texture.jpg', normalMap: 'ganymede_map.jpg', normalScale: 0.65, radius: 1.7, distance: 50 },
      { name: 'Callisto', file: 'callisto_texture.jpg', normalMap: 'callisto_map.jpg', normalScale: 0.55, radius: 1.5, distance: 62 },
    ],
  },
  {
    name: 'Mars', file: 'mars_texture.jpg', normalMap: 'mars_map.jpg', normalScale: 0.25,
    radius: 2, position: [-6, 3, -295],
    atmosphere: { color: '#f0c49a', intensity: 0.6, thickness: 0.035, density: 0.5, mie: 3 },
  },
  {
    name: 'Planète fictive 3', file: 'fictional3_texture.jpg', normalMap: 'fictional3_map.jpg', normalScale: 0.65,
    radius: 10, position: [16, -6, -395],
    atmosphere: { color: '#8fffe0', intensity: 1 },
  },
  {
    // fictional2_map.jpg est défectueuse (normales tournées vers l'intérieur) : pas de relief.
    name: 'Planète fictive 2', file: 'fictif2_texture.jpg', radius: 32, position: [-41, 10, -500],
    atmosphere: { color: '#ffb890', intensity: 0.9, thickness: 0.04 },
  },
  {
    name: 'Planète fictive 4', file: 'fictional4_texture.jpg', normalMap: 'fictional4_map.jpg', normalScale: 0.4,
    radius: 3, position: [8, -3, -610],
    atmosphere: { color: '#c8a8ff', intensity: 0.8 },
  },
  {
    name: 'Planète fictive 5', file: 'fictional5_texture.jpg', normalMap: 'fictional5_map.jpg', normalScale: 0.85,
    radius: 7, position: [-14, 4, -700],
  },
  {
    name: 'Planète fictive 6', file: 'fictional6_texture.jpg', normalMap: 'fictional6_map.jpg', normalScale: 0.2,
    radius: 16, position: [24, -8, -810],
    atmosphere: { color: '#a8d8ff', intensity: 0.8, thickness: 0.03 },
  },
]

// Le relief de la carte de normales ne doit jamais éclairer la face nocturne :
// la lumière du Soleil est coupée selon la normale géométrique de la sphère
// (sans relief), avec une transition courte pour garder des reliefs rasants au terminateur.
const TERMINATOR_WIDTH = 0.08
const nightSideLights = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  `getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= smoothstep( 0.0, ${TERMINATOR_WIDTH.toFixed(2)}, dot( nonPerturbedNormal, directLight.direction ) );`,
)

function darkenNightSide(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', nightSideLights)
  }
}

export function createPlanets({ scene, renderer, sun }) {
  // Une géométrie commune, avec une taille et une texture propres à chaque astre.
  const geometry = new THREE.SphereGeometry(1, 64, 64)
  const textureLoader = new THREE.TextureLoader()
  const materials = []
  const atmospheres = []
  const orbits = []
  const reliefMaterials = []

  function createBody({ name, file, normalMap, normalScale = 1, radius, atmosphere }) {
    const texture = textureLoader.load(`${import.meta.env.BASE_URL}${file}`)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
    darkenNightSide(material)
    if (normalMap) {
      // Carte de normales : données linéaires, pas d'espace colorimétrique sRGB.
      material.normalMap = textureLoader.load(`${import.meta.env.BASE_URL}normal_maps/${normalMap}`)
      material.normalMap.anisotropy = texture.anisotropy
      // Le canal rouge des cartes de normal_maps est inversé par rapport au vert (convention OpenGL) :
      // x négatif pour que les mers restent des creux sous toutes les directions de lumière.
      material.normalScale.set(-normalScale, normalScale)
      reliefMaterials.push({ name, material })
    }
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

  const planets = PLANETS.map(({ position, satellites = [], orbitSpeed = 1, ...body }) => {
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
      orbits.push({ orbit, speed: 0.15 * orbitSpeed * Math.pow(body.radius / satellite.distance, 1.5) })
    }
    scene.add(system)
    return { center: system.position, radius: body.radius }
  })

  return {
    planets,
    reliefMaterials,
    update(delta, camera) {
      for (const { orbit, speed } of orbits) orbit.rotation.y += speed * delta
      updateAtmosphereSides(atmospheres, camera)
    },
    dispose() {
      geometry.dispose()
      for (const material of materials) {
        material.map.dispose()
        material.normalMap?.dispose()
        material.dispose()
      }
      for (const atmosphere of atmospheres) atmosphere.material.dispose()
    },
  }
}
