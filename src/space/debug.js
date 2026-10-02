import { Pane } from 'tweakpane'

// Panneaux de réglage masqués par défaut : ajouter ?debug à l'adresse pour les afficher.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Panneau de réglage du halo : chaque modification est journalisée,
// prête à être recopiée comme valeur par défaut de BLOOM dans postprocessing.js.
export function createDebugPane(bloom, reliefMaterials = [], fog = null, glass = null, galaxy = null) {
  const pane = new Pane({ title: 'Glow' })
  // Masqué par défaut ; ajouter ?debug à l'adresse (ex. localhost:5173/?debug) pour l'afficher.
  pane.hidden = !DEBUG
  pane.addBinding(bloom, 'strength', { min: 0, max: 3, step: 0.01 })
  pane.addBinding(bloom, 'radius', { min: 0, max: 1, step: 0.01 })
  pane.addBinding(bloom, 'threshold', { min: 0, max: 2, step: 0.01 })

  // Reflets du verre du « 404 », à recopier comme valeur par défaut de GLASS dans glass404.js.
  if (glass) {
    const folder = pane.addFolder({ title: 'Glass' })
    folder.addBinding(glass, 'reflections', { label: 'reflets', min: 0, max: 1.5, step: 0.01 })
      .on('change', (event) => {
        if (event.last) console.log(`const GLASS = { reflections: ${event.value} }`)
      })
  }

  // Fond galactique, à recopier comme valeur par défaut de GALAXY dans galaxy.js.
  // La texture est recalculée à chaque changement (quelques millisecondes).
  if (galaxy) {
    const folder = pane.addFolder({ title: 'Galaxy', expanded: false })
    const { settings } = galaxy
    folder.addBinding(settings, 'brightness', { label: 'luminosité', min: 0, max: 0.3, step: 0.005 })
    folder.addBinding(settings, 'tilt', { label: 'inclinaison', min: -1.57, max: 1.57, step: 0.01 })
    folder.addBinding(settings, 'width', { label: 'largeur', min: 0.05, max: 0.6, step: 0.01 })
    folder.addBinding(settings, 'dust', { label: 'poussière', min: 0, max: 1, step: 0.01 })
    folder.addBinding(settings, 'stars', { label: 'étoiles', min: 0, max: 4, step: 0.05 })
    folder.addBinding(settings, 'cool', { label: 'teinte' })
    folder.addBinding(settings, 'warm', { label: 'bulbe' })
    // La galaxie en splats se règle dans le panneau « 404 » (createPortalPane).
    folder.on('change', (event) => {
      galaxy.bake()
      if (event.last) console.log(`const GALAXY = ${JSON.stringify(settings)}`)
    })
  }

  // Brouillard, à recopier comme valeur par défaut de FOG dans fog.js.
  if (fog) {
    const folder = pane.addFolder({ title: 'Fog' })
    folder.addBinding(fog.settings, 'density', { label: 'quantité', min: 0, max: 0.03, step: 0.0005 })
    folder.addBinding(fog.settings, 'sky', { label: 'fond', min: 0, max: 1, step: 0.01 })
    folder.addBinding(fog.settings, 'color', { label: 'couleur' })
    folder.on('change', (event) => {
      fog.apply()
      if (event.last) {
        const { color, density, sky } = fog.settings
        console.log(`const FOG = { color: '${color}', density: ${density}, sky: ${sky} }`)
      }
    })
  }

  // Intensité des cartes de normales, à recopier dans normalScale de PLANETS (planets.js).
  const reliefFolder = pane.addFolder({ title: 'Relief', expanded: false })
  for (const { name, material } of reliefMaterials) {
    const relief = { [name]: material.normalScale.y }
    reliefFolder.addBinding(relief, name, { min: 0, max: 2, step: 0.05 }).on('change', (event) => {
      material.normalScale.set(-event.value, event.value)
      if (event.last) console.log(`${name} : normalScale: ${event.value}`)
    })
  }

  function log() {
    // Arrondi à 2 décimales : évite les artefacts de virgule flottante (0.06999999999999997).
    const [strength, radius, threshold] = [bloom.strength, bloom.radius, bloom.threshold]
      .map((value) => Math.round(value * 100) / 100)
    console.log(`const BLOOM = { strength: ${strength}, radius: ${radius}, threshold: ${threshold} }`)
  }
  // Une seule ligne par geste : la valeur finale, pas chaque étape du glisser.
  pane.on('change', (event) => { if (event.last) log() })
  pane.addButton({ title: 'Log values' }).on('click', log)

  return {
    dispose() {
      pane.dispose()
    },
  }
}

// État du panneau « 404 » gardé dans le navigateur (localStorage) : réglages et dossiers ouverts.
// Rangé par nom de réglage, pas par position dans le panneau : ajouter un curseur plus tard ne mélange
// pas les valeurs. Un réglage disparu ou d'un autre type est ignoré.
const STORAGE_KEY = 'page404:panel'

function readStorage() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeStorage(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Stockage indisponible (navigation privée…) : le panneau marche, sans mémoire.
  }
}

function restore(target, saved = {}) {
  for (const [key, value] of Object.entries(saved)) {
    if (key in target && typeof value === typeof target[key]) target[key] = value
  }
}

// Panneau du « 404 », toujours visible, en haut à gauche (le panneau principal, masqué par défaut,
// occupe la droite) : halo des reflets, chanfrein des chiffres, galaxie et occlusion du sol. Chaque
// geste journalise la valeur à recopier comme valeur par défaut.
export function createPortalPane(portal, galaxy = null) {
  const container = document.createElement('div')
  container.style.cssText = 'position: fixed; top: 8px; left: 8px; width: 260px; z-index: 10;'
  document.body.append(container)
  const { halo, ao, chamfer } = portal
  const galaxySettings = galaxy?.settings ?? {}

  // Valeurs gardées appliquées avant de créer les curseurs, qui les affichent donc directement.
  // Panneau masqué : rien n'est relu, les valeurs par défaut du code s'appliquent telles quelles.
  const saved = DEBUG ? readStorage() : {}
  restore(halo, saved.halo)
  restore(ao, saved.ao)
  restore(chamfer, saved.chamfer)
  restore(galaxySettings, saved.galaxy)
  if (chamfer.chamfer !== portal.glassChamfer) portal.setChamfer(chamfer.chamfer)
  galaxy?.bake()

  const folders = saved.folders ?? {}
  const pane = new Pane({ title: '404', container, expanded: folders.root ?? true })
  // Masqué par défaut, comme le panneau principal (?debug pour l'afficher).
  container.hidden = !DEBUG
  function save() {
    writeStorage({ halo, ao, chamfer, galaxy: galaxySettings, folders })
  }
  pane.on('fold', (event) => {
    folders.root = event.expanded
    save()
  })
  function addFolder(title) {
    const folder = pane.addFolder({ title, expanded: folders[title] ?? true })
    folder.on('fold', (event) => {
      folders[title] = event.expanded
      save()
    })
    return folder
  }
  pane.on('change', (event) => {
    if (event.last) save()
  })

  const glow = addFolder('Glow')
  glow.addBinding(halo, 'strength', { label: 'intensité', min: 0, max: 6, step: 0.05 })
  glow.addBinding(halo, 'radius', { label: 'étalement', min: 0, max: 5, step: 0.05 })
  glow.addBinding(halo, 'threshold', { label: 'seuil', min: 0, max: 2, step: 0.01 })
  glow.addBinding(halo, 'tint', { label: 'couleur fixe', min: 0, max: 1, step: 0.01 })
  glow.addBinding(halo, 'color', { label: 'couleur' })
  glow.on('change', (event) => {
    if (event.last) console.log(`export const HALO = ${JSON.stringify(halo)}`)
  })

  const edges = addFolder('Chanfrein')
  edges.addBinding(chamfer, 'chamfer', { label: 'largeur', min: 0, max: 0.2, step: 0.005 })
    .on('change', (event) => {
      portal.setChamfer(event.value)
      if (event.last) console.log(`export const CHAMFER = { chamfer: ${event.value} }`)
    })

  // Galaxie en splats : position libre (sans bornes), échelle, suivi, orientation, à recopier dans
  // GALAXY (galaxy.js). Appliqués à chaque image : aucun recalcul du fond.
  if (galaxy) {
    const folder = addFolder('Galaxie')
    folder.addBinding(galaxySettings, 'galaxyX', { label: 'position x', step: 1 })
    folder.addBinding(galaxySettings, 'galaxyY', { label: 'position y', step: 1 })
    folder.addBinding(galaxySettings, 'galaxyZ', { label: 'position z', step: 1 })
    folder.addBinding(galaxySettings, 'galaxyRadius', { label: 'échelle', min: 1, max: 3000, step: 1 })
    folder.addBinding(galaxySettings, 'splatTilt', { label: 'inclinaison', min: -3.14, max: 3.14, step: 0.01 })
    folder.addBinding(galaxySettings, 'splatSpin', { label: 'rotation', min: -3.14, max: 3.14, step: 0.01 })
    folder.addBinding(galaxySettings, 'splatIntensity', { label: 'luminosité', min: 0, max: 1.5, step: 0.01 })
    folder.addBinding(galaxySettings, 'splatFraction', { label: 'nombre de splats', min: 0, max: 1, step: 0.01 })
    folder.addBinding(galaxySettings, 'splatScale', { label: 'rayon des splats', min: 0.1, max: 5, step: 0.05 })
    folder.addBinding(galaxySettings, 'splatRoundness', { label: 'traits → points', min: 0, max: 1, step: 0.01 })
    folder.addBinding(galaxySettings, 'splatTint', { label: 'teinte' })
    folder.on('change', (event) => {
      if (event.last) console.log(`const GALAXY = ${JSON.stringify(galaxySettings)}`)
    })
  }

  const occlusion = addFolder('SSAO')
  occlusion.addBinding(ao, 'strength', { label: 'intensité', min: 0, max: 1.5, step: 0.01 })
  occlusion.addBinding(ao, 'radius', { label: 'rayon', min: 0.05, max: 3, step: 0.05 })
  occlusion.on('change', (event) => {
    if (event.last) console.log(`export const AO = ${JSON.stringify(ao)}`)
  })

  return {
    dispose() {
      pane.dispose()
      container.remove()
    },
  }
}
