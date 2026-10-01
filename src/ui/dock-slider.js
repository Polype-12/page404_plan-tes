// Curseur « amarrage » : on fait glisser le satellite jusqu'à la planète pour l'activer.
// C'est un <input type="range"> natif (clavier et lecteurs d'écran compris), habillé en CSS.
// Lâché avant la planète, le satellite revient en douceur à son point de départ.
const RETURN_DURATION = 350

export function createDockSlider(root, { onDock = () => {} } = {}) {
  const input = root.querySelector('input[type="range"]')
  const max = Number(input.max)
  let frame = null

  // Avancement 0 à 1, pour effacer les pointillés déjà parcourus (voir style.css).
  function showProgress() {
    root.style.setProperty('--progress', Number(input.value) / max)
  }

  function setDocked(docked) {
    if (root.classList.contains('is-docked') === docked) return
    root.classList.toggle('is-docked', docked)
    input.setAttribute('aria-valuetext', docked ? 'Satellite amarré' : `${Math.round(input.value)} %`)
    if (docked) onDock()
  }

  function cancelReturn() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  function returnToStart() {
    cancelReturn()
    const from = Number(input.value)
    const start = performance.now()
    const step = (now) => {
      const t = Math.min((now - start) / RETURN_DURATION, 1)
      input.value = from * (1 - t) ** 3
      showProgress()
      frame = t < 1 ? requestAnimationFrame(step) : null
    }
    frame = requestAnimationFrame(step)
  }

  function onInput() {
    cancelReturn()
    showProgress()
    setDocked(Number(input.value) >= max)
  }

  // Fin du geste (souris, doigt ou clavier) : amarré, il reste ; sinon, il revient.
  function onRelease() {
    if (Number(input.value) < max) returnToStart()
  }

  input.addEventListener('input', onInput)
  input.addEventListener('change', onRelease)
  input.addEventListener('pointerdown', cancelReturn)

  return {
    dispose() {
      cancelReturn()
      input.removeEventListener('input', onInput)
      input.removeEventListener('change', onRelease)
      input.removeEventListener('pointerdown', cancelReturn)
    },
  }
}
