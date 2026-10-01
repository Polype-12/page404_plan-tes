import * as THREE from 'three'
import { createAtmosphere, updateAtmosphereSides } from './atmosphere.js'

// Positions [x, y, z] : plus z est négatif, plus l'astre est loin au départ.
// Les astres s'enroulent en slalom autour de l'axe de la caméra (un côté puis l'autre, en haut puis
// en bas) : la centralité reste lisible, mais chaque rencontre demande un léger écart latéral.
// Les écarts x et y ci-dessous sont multipliés par SPREAD pour occuper toute la largeur et la hauteur
// de l'écran, avec des intervalles de profondeur irréguliers.
// atmosphere : options de createAtmosphere. satellites : distance au centre, en unités du monde.
// normalMap : fichier de public/normal_maps. normalScale : intensité du relief, calibrée
// pour une inclinaison moyenne d'environ 10° (plus faible pour Vénus et Jupiter, réglable dans le panneau).
const SPREAD = { x: 2.2, y: 2.8 }

// Astre qui frôle la caméra : centré à radius + CLEARANCE de l'axe du couloir (x = y = 0), dans la
// direction angle (degrés, 0 = droite, 90 = haut). Position finale, non multipliée par SPREAD :
// la surface passe à CLEARANCE de la caméra sans jamais traverser le plan proche. On entre dans
// l'espace par un jambage du « 0 » (x ≈ ±1.4) : la clairance inclut ce décalage.
const CLEARANCE = 3
function flyby(radius, angle, z) {
  const distance = radius + CLEARANCE
  const theta = THREE.MathUtils.degToRad(angle)
  return { radius, position: [Math.cos(theta) * distance, Math.sin(theta) * distance, z], spread: false }
}

// Astres groupés autour du « 404 », juste derrière la fenêtre (plan z = 18) : vus à travers les
// chiffres dès l'arrivée. Positions finales, non multipliées par SPREAD ; ils restent à plus de
// rayon + 1.5 de la trajectoire de plongée (x = ±1.4, y = 0). Ce groupe n'existe qu'au premier
// passage : aux répétitions suivantes du couloir, chacun est dispersé ailleurs (voir scatter).
const AROUND_404 = [
  // Derrière le 4 de gauche et celui de droite (centres des chiffres à x = ±4.7).
  { name: 'Derrière 4 gauche', file: 'mars_texture.jpg', normalMap: 'mars_map.jpg', normalScale: 0.8, radius: 1.6, position: [-4.7, 0, 12], spread: false, around404: true },
  { name: 'Derrière 4 droite', file: 'fictional4_texture.jpg', normalMap: 'fictional4_map.jpg', normalScale: 0.7, radius: 1.4, position: [4.7, 0.3, 11], spread: false, around404: true },
  { name: 'Autour 1', file: 'fictional5_texture.jpg', normalMap: 'fictional5_map.jpg', normalScale: 1.1, radius: 2.2, position: [-10, 5, 10], spread: false, around404: true },
  { name: 'Autour 2', file: 'fictional6_texture.jpg', normalMap: 'fictional6_map.jpg', normalScale: 0.65, radius: 2, position: [10, -5, 9], spread: false, around404: true },
  { name: 'Autour 3', file: 'ganymede_texture.jpg', normalMap: 'ganymede_map.jpg', normalScale: 0.9, radius: 1, position: [8.5, 5.5, 13], spread: false, around404: true },
  { name: 'Autour 4', file: 'io_texture.jpg', normalMap: 'io_map.jpg', normalScale: 0.95, radius: 1.3, position: [-8.5, -5.5, 13], spread: false, around404: true },
  { name: 'Autour 5', file: 'fiction1_texture.jpg', normalMap: 'fictional1_map.jpg', normalScale: 0.85, radius: 1.8, position: [0.5, 7, 8], spread: false, around404: true },
  { name: 'Autour 6', file: 'callisto_texture.jpg', normalMap: 'callisto_map.jpg', normalScale: 0.9, radius: 1.5, position: [-0.5, -7.5, 10], spread: false, around404: true },
  { name: 'Autour 7', file: 'fictif2_texture.jpg', normalMap: 'fictional2_map.jpg', normalScale: 0.8, radius: 3, position: [-16, 0.5, 5], spread: false, around404: true },
  { name: 'Autour 8', file: 'fictional3_texture.jpg', normalMap: 'fictional3_map.jpg', normalScale: 1, radius: 2.5, position: [16, 1, 3], spread: false, around404: true },
]

export const PLANETS = [
  ...AROUND_404,
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
  // Passages rapprochés, sans atmosphère : la clairance ne dépend que du rayon.
  { name: 'Frôleuse 1', file: 'callisto_texture.jpg', normalMap: 'callisto_map.jpg', normalScale: 0.9, ...flyby(2.5, 35, -160) },
  { name: 'Frôleuse 2', file: 'io_texture.jpg', normalMap: 'io_map.jpg', normalScale: 0.95, ...flyby(1.8, 215, -370) },
  { name: 'Frôleuse 3', file: 'europa_texture.jpg', normalMap: 'europa_map.jpg', normalScale: 0.9, ...flyby(3.5, 130, -660) },
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

// Défilement infini : le couloir se répète tous les LOOP_LENGTH. Aucun astre n'est créé ni détruit :
// un système passé derrière la caméra (à plus de BEHIND) est replacé LOOP_LENGTH plus loin devant,
// à pleine taille : il surgit à près de 1000 unités, là où le brouillard (fog.js) le cache encore.
// Une répétition sur deux est inversée en x pour que le motif ne saute pas aux yeux.
export const LOOP_LENGTH = 1100
const BEHIND = 120

// Place dispersée d'un astre du groupe du « 404 » pour les répétitions suivantes du couloir : les
// profondeurs sont réparties en tranches régulières (avec un jeu), l'écart à l'axe est tiré au hasard,
// loin de la trajectoire, et chaque place évite les autres astres (profondeurs comparées modulo
// LOOP_LENGTH, comme dans le couloir).
function scatter(index, count, radius, taken) {
  const place = new THREE.Vector3()
  const other = new THREE.Vector3()
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = Math.random() * Math.PI * 2
    const distance = THREE.MathUtils.randFloat(radius + 6, 55)
    const z = -LOOP_LENGTH * (index + THREE.MathUtils.randFloat(0.25, 0.75)) / count
    place.set(Math.cos(angle) * distance, Math.sin(angle) * distance, z)
    const free = taken.every(({ position, radius: otherRadius }) => {
      other.fromArray(position)
      other.z = place.z + THREE.MathUtils.euclideanModulo(other.z - place.z + LOOP_LENGTH / 2, LOOP_LENGTH) - LOOP_LENGTH / 2
      return place.distanceTo(other) > radius + otherRadius + 12
    })
    if (free) break
  }
  return place.toArray()
}

export function createPlanets({ scene, renderer, sun }) {
  // Une géométrie commune, avec une taille et une texture propres à chaque astre.
  const geometry = new THREE.SphereGeometry(1, 64, 64)
  const textureLoader = new THREE.TextureLoader()
  const materials = []
  const atmospheres = []
  const orbits = []
  const reliefMaterials = []
  const systems = []
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

  // Places de tous les astres du couloir, puis places dispersées du groupe du « 404 ».
  // Un système à satellites occupe tout le disque de leurs orbites.
  const taken = PLANETS.filter(({ around404 }) => !around404).map(({ position, spread = true, radius, satellites = [] }) => ({
    position: spread ? [position[0] * SPREAD.x, position[1] * SPREAD.y, position[2]] : position,
    radius: Math.max(radius, ...satellites.map((satellite) => satellite.distance + satellite.radius)),
  }))
  const aroundCount = PLANETS.filter(({ around404 }) => around404).length
  let aroundIndex = 0

  const planets = PLANETS.map(({ position, spread = true, satellites = [], orbitSpeed = 1, around404 = false, ...body }) => {
    // Le système porte l'inclinaison aléatoire de l'axe, partagée par le plan orbital des satellites.
    const system = new THREE.Group()
    const base = spread ? [position[0] * SPREAD.x, position[1] * SPREAD.y, position[2]] : position
    system.position.set(...base)
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
    let roam = null
    if (around404) {
      roam = scatter(aroundIndex++, aroundCount, body.radius, taken)
      taken.push({ position: roam, radius: body.radius })
    }
    systems.push({ system, base, roam, loop: 0 })
    return { center: system.position, radius: body.radius }
  })

  // Premier passage : la place près du « 404 ». Ensuite : la place dispersée, répétée comme le couloir,
  // visible seulement si elle est apparue au loin après la fin du premier passage (pas de surgissement).
  function placeAround404(entry, cameraZ) {
    const [x, y, z] = entry.base
    if (Math.floor((cameraZ + BEHIND - z) / LOOP_LENGTH) === 0) {
      entry.system.position.set(x, y, z)
      entry.system.visible = true
      return
    }
    const [roamX, roamY, roamZ] = entry.roam
    const loop = Math.floor((cameraZ + BEHIND - roamZ) / LOOP_LENGTH)
    const depth = roamZ + loop * LOOP_LENGTH
    entry.system.position.set(loop % 2 ? -roamX : roamX, roamY, depth)
    entry.system.visible = depth <= z - LOOP_LENGTH
  }

  return {
    planets,
    reliefMaterials,
    update(delta, camera) {
      for (const { orbit, speed } of orbits) orbit.rotation.y += speed * delta
      const cameraZ = camera.position.z
      for (const entry of systems) {
        const [x, y, z] = entry.base
        if (entry.roam) {
          placeAround404(entry, cameraZ)
          continue
        }
        const loop = Math.floor((cameraZ + BEHIND - z) / LOOP_LENGTH)
        if (loop !== entry.loop) {
          entry.loop = loop
          entry.system.position.set(loop % 2 ? -x : x, y, z + loop * LOOP_LENGTH)
        }
      }
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
