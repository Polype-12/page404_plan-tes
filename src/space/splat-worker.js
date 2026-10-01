import { measure, parseCompressedPly, sortFromOrigin } from './splat-parse.js'

// Travail lourd de la galaxie en arrière-plan : chargement et décodage du fichier, puis chaque tri.
let data = null

self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === 'load') {
      const response = await fetch(message.url)
      if (!response.ok) throw new Error(`${message.url} introuvable (${response.status}).`)
      data = parseCompressedPly(await response.arrayBuffer())
      self.postMessage({ type: 'loaded', count: data.count, ...measure(data) })
    } else if (message.type === 'sort') {
      const sorted = sortFromOrigin(data, message.matrix)
      self.postMessage({ type: 'sorted', id: message.id, ...sorted },
        [sorted.centers.buffer, sorted.covA.buffer, sorted.covB.buffer, sorted.colors.buffer])
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `splat-galaxy : ${error.message}` })
  }
}
