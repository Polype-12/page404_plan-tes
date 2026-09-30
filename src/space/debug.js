import { Pane } from 'tweakpane'

// Panneau de réglage du halo : chaque modification est journalisée,
// prête à être recopiée comme valeur par défaut de BLOOM dans postprocessing.js.
export function createDebugPane(bloom, reliefMaterials = []) {
  const pane = new Pane({ title: 'Glow' })
  pane.addBinding(bloom, 'strength', { min: 0, max: 3, step: 0.01 })
  pane.addBinding(bloom, 'radius', { min: 0, max: 1, step: 0.01 })
  pane.addBinding(bloom, 'threshold', { min: 0, max: 2, step: 0.01 })

  // Intensité des cartes de normales, à recopier dans normalScale de PLANETS (planets.js).
  for (const { name, material } of reliefMaterials) {
    const relief = { [`Relief ${name}`]: material.normalScale.y }
    pane.addBinding(relief, `Relief ${name}`, { min: 0, max: 2, step: 0.05 }).on('change', (event) => {
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
