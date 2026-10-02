// Curseur « amarrage » : on fait glisser le satellite jusqu'à la planète pour l'activer.
// C'est un <input type="range"> natif (clavier et lecteurs d'écran compris), habillé en CSS.
// Lâché avant la planète, le satellite revient en douceur à son point de départ.
const RETURN_DURATION = 350
// Écart visé entre les points (px) ; l'écart réel est ajusté pour tomber juste entre les icônes.
const DOT_SPACING = 8

export function createDockSlider(root, { onDock = () => {} } = {}) {
  const input = root.querySelector('input[type="range"]')
  const track = root.querySelector('.dock-track')
  const planet = root.querySelector('.dock-planet')
  const layer = root.querySelector('.dock-dots')
  const max = Number(input.max)
  let frame = null

  // Pointillés : même écart entre le bord du satellite (au repos) et le premier point, entre deux
  // points, et entre le dernier point et le bord de la planète. Mesures en offset (non touchées par
  // le grossissement de la planète amarrée), relatives au curseur.
  let dots = []
  let spacing = DOT_SPACING
  // Taille du satellite : la hauteur du curseur (--dock-size, résolu par le navigateur même s'il
  // s'agit d'un clamp()).
  function thumbSize() {
    return input.offsetHeight
  }
  // Bord droit du satellite pour une valeur donnée (la poignée parcourt la largeur moins sa taille).
  function satelliteEdge(value) {
    const size = thumbSize()
    return track.offsetLeft + input.offsetLeft + (value / max) * (input.offsetWidth - size) + size
  }
  function layoutDots() {
    const start = satelliteEdge(0)
    const distance = planet.offsetLeft - start
    const gaps = Math.max(1, Math.round(distance / DOT_SPACING))
    spacing = distance / gaps
    layer.replaceChildren()
    dots = Array.from({ length: gaps - 1 }, (_, index) => {
      const dot = document.createElement('span')
      dot.className = 'dock-dot'
      dot.style.left = `${start + (index + 1) * spacing}px`
      layer.append(dot)
      return { dot, x: start + (index + 1) * spacing }
    })
    showProgress()
  }

  // Un point disparaît dès que le satellite en serait plus près que l'écart : il reste toujours au
  // moins un écart entre le satellite et le point suivant.
  function showProgress() {
    const edge = satelliteEdge(Number(input.value))
    for (const { dot, x } of dots) dot.classList.toggle('is-gone', x - edge < spacing - 0.5)
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

  // Retour sur la page (bouton « précédent » après l'ECAL) : le navigateur peut la restaurer telle
  // qu'elle était, satellite amarré. Il repart du début, comme au premier chargement.
  function reset() {
    cancelReturn()
    input.value = 0
    root.classList.remove('is-docked')
    input.removeAttribute('aria-valuetext')
    showProgress()
  }
  function onPageShow(event) {
    if (event.persisted) reset()
  }
  window.addEventListener('pageshow', onPageShow)

  // Recalcul si la mise en page change (taille du texte, du curseur…).
  const resizeObserver = new ResizeObserver(layoutDots)
  resizeObserver.observe(root)
  layoutDots()
  reset()

  input.addEventListener('input', onInput)
  input.addEventListener('change', onRelease)
  input.addEventListener('pointerdown', cancelReturn)

  return {
    dispose() {
      cancelReturn()
      resizeObserver.disconnect()
      window.removeEventListener('pageshow', onPageShow)
      layer.replaceChildren()
      input.removeEventListener('input', onInput)
      input.removeEventListener('change', onRelease)
      input.removeEventListener('pointerdown', cancelReturn)
    },
  }
}
