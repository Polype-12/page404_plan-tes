import * as THREE from 'three'
import { createAtmosphere, updateAtmosphereSides } from './atmosphere.js'

// Positions [x, y, z] : plus z est négatif, plus l'astre est loin au départ.
// Les astres s'enroulent en slalom autour de l'axe de la caméra (un côté puis l'autre, en haut puis
// en bas) : la centralité reste lisible, mais chaque rencontre demande un léger écart latéral.
// L'écart au centre est de l'ordre de 2 à 3 rayons, avec des intervalles de profondeur irréguliers.
// atmosphere : options de createAtmosphere. satellites : distance au centre, en unités du monde.
// normalMap : fichier de public/normal_maps. normalScale : intensité du relief, calibrée
// pour une inclinaison moyenne d'environ 10° (plus faible pour Vénus et Jupiter, réglable dans le panneau).
export const PLANETS = [
  { name: 'Lune', file: 'lune_texture.jpg', normalMap: 'lune_map.jpg', normalScale: 1, radius: 0.8, position: [-2.7, 1.5, 5] },
  {
    name: 'Planète fictive', file: 'fiction1_texture.jpg', normalMap: 'fictional1_map.jpg', normalScale: 0.85,
    radius: 1.3, position: [7, -3, -48],
    atmosphere: { color: '#9fd0ff', intensity: 0.9 },
  },
  {
    // Couche nuageuse : relief discret.
    name: 'Vénus', file: 'venus_texture.jpg', normalMap: 'venus_map.jpg', normalScale: 1,
    radius: 5, position: [-17, 6, -112],
    atmosphere: { color: '#ffe2a8', intensity: 1.2, thickness: 0.07, density: 2.5, mie: 2 },
  },
  {
    // Géante gazeuse : bandes à peine modelées.
    name: 'Jupiter', file: 'jupiter_texture.jpg', normalMap: 'jupiter_map.jpg', normalScale: 0.4,
    radius: 22, position: [40, -10, -215],
    atmosphere: { color: '#b4ccff', intensity: 0.7, thickness: 0.025 },
    // Multiplicateur de la vitesse orbitale des satellites (1 par défaut).
    orbitSpeed: 0.1,
    satellites: [
      { name: 'Io', file: 'io_texture.jpg', normalMap: 'io_map.jpg', normalScale: 0.95, radius: 1.2, distance: 32 },
      { name: 'Europe', file: 'europa_texture.jpg', normalMap: 'europa_map.jpg', normalScale: 0.9, radius: 1, distance: 40 },
      { name: 'Ganymède', file: 'ganymede_texture.jpg', normalMap: 'ganymede_map.jpg', normalScale: 0.9, radius: 1.7, distance: 50 },
      { name: 'Callisto', file: 'callisto_texture.jpg', normalMap: 'callisto_map.jpg', normalScale: 0.9, radius: 1.5, distance: 62 },
    ],
  },
  {
    name: 'Mars', file: 'mars_texture.jpg', normalMap: 'mars_map.jpg', normalScale: 0.8,
    radius: 2, position: [-11, -5, -315],
    atmosphere: { color: '#f0c49a', intensity: 0.6, thickness: 0.035, density: 0.5, mie: 3 },
  },
  {
    name: 'Planète fictive 3', file: 'fictional3_texture.jpg', normalMap: 'fictional3_map.jpg', normalScale: 1,
    radius: 10, position: [24, 10, -410],
    atmosphere: { color: '#8fffe0', intensity: 1 },
  },
  {
    name: 'Planète fictive 2', file: 'fictif2_texture.jpg', normalMap: 'fictional2_map.jpg', normalScale: 0.8,
    radius: 32, position: [-60, -14, -520],
    atmosphere: { color: '#ffb890', intensity: 0.9, thickness: 0.04 },
  },
  {
    name: 'Planète fictive 4', file: 'fictional4_texture.jpg', normalMap: 'fictional4_map.jpg', normalScale: 0.7,
    radius: 3, position: [12, -8, -602],
    atmosphere: { color: '#c8a8ff', intensity: 0.8 },
  },
  {
    name: 'Planète fictive 5', file: 'fictional5_texture.jpg', normalMap: 'fictional5_map.jpg', normalScale: 1.1,
    radius: 7, position: [-22, 11, -705],
  },
  {
    name: 'Planète fictive 6', file: 'fictional6_texture.jpg', normalMap: 'fictional6_map.jpg', normalScale: 0.65,
    radius: 16, position: [42, -16, -815],
    atmosphere: { color: '#a8d8ff', intensity: 0.8, thickness: 0.03 },
  },
]

// Terminateur : la face nocturne reste noire, mais la lumière s'y éteint en douceur.
// Tout est calculé avec la normale géométrique de la sphère (sans relief) :
// - la lumière décroît jusqu'à zéro sur TERMINATOR_WIDTH, sans ligne de coupure,
//   et le relief de la carte de normales ne peut pas éclairer la nuit ;
// - l'ombre de la sphère sur elle-même (dure, crénelée) est ignorée près du terminateur :
//   seules les ombres d'un astre sur un autre (éclipses, côté jour) sont conservées.
const TERMINATOR_WIDTH = 0.1
const SUN_FACING = 'dot( nonPerturbedNormal, directLight.direction )'
function patchChunk(chunk, search, replacement) {
  if (!chunk.includes(search)) throw new Error(`Chunk Three.js inattendu : ${search}`)
  return chunk.replace(search, replacement)
}
let nightSideLights = patchChunk(
  THREE.ShaderChunk.lights_fragment_begin,
  'getDirectionalLightInfo( directionalLight, directLight );',
  `getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= smoothstep( 0.0, ${TERMINATOR_WIDTH.toFixed(2)}, ${SUN_FACING} );`,
)
nightSideLights = patchChunk(
  nightSideLights,
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]',
  'directLight.color *= mix( 1.0, ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]',
)
nightSideLights = patchChunk(
  nightSideLights,
  'vDirectionalShadowCoord[ i ] ) : 1.0;',
  `vDirectionalShadowCoord[ i ] ) : 1.0, smoothstep( 0.1, 0.3, ${SUN_FACING} ) );`,
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
      // Le canal bleu des cartes fournies est faux (normales trop courtes, parfois tournées
      // vers l'intérieur) : Three.js le recalcule à partir du rouge et du vert.
      material.defines = { ...material.defines, USE_PACKED_NORMALMAP: '' }
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
