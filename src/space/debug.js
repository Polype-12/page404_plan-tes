import { Pane } from 'tweakpane'

// Panneau de réglage du halo : chaque modification est journalisée,
// prête à être recopiée comme valeur par défaut de BLOOM dans postprocessing.js.
export function createDebugPane(bloom, reliefMaterials = [], fog = null, glass = null, galaxy = null) {
  const pane = new Pane({ title: 'Glow' })
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
    folder.addBinding(settings, 'splatIntensity', { label: 'galaxie', min: 0, max: 1.5, step: 0.01 })
    folder.addBinding(settings, 'splatSize', { label: 'taille (°)', min: 5, max: 120, step: 1 })
    folder.addBinding(settings, 'splatYaw', { label: 'direction x', min: -3.14, max: 3.14, step: 0.01 })
    folder.addBinding(settings, 'splatPitch', { label: 'direction y', min: -1.4, max: 1.4, step: 0.01 })
    folder.addBinding(settings, 'splatTilt', { label: 'inclinaison galaxie', min: -3.14, max: 3.14, step: 0.01 })
    folder.addBinding(settings, 'splatSpin', { label: 'rotation', min: -3.14, max: 3.14, step: 0.01 })
    folder.addBinding(settings, 'splatTint', { label: 'teinte galaxie' })
    // Déplacer la galaxie impose un nouveau tri (~0,1 s) : recuit seulement en fin de geste.
    const moves = ['splatSize', 'splatYaw', 'splatPitch', 'splatTilt', 'splatSpin']
    folder.on('change', (event) => {
      if (!event.last && moves.includes(event.target.key)) return
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
