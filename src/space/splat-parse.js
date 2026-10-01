import * as THREE from 'three'

// Lecture et tri des splats de la galaxie (splat-galaxy.js), exécutés dans splat-worker.js pour ne
// jamais figer la page : ~0,4 s de décodage et ~0,15 s de tri pour 566 000 splats.

const CHUNK_SIZE = 256

// Lecture du format compressé : par paquets de 256, chaque splat tient en quatre uint32 quantifiés
// entre les bornes de son paquet (position, rotation, échelle, couleur).
export function parseCompressedPly(buffer) {
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64 * 1024)))
  const end = header.indexOf('end_header\n')
  if (!header.startsWith('ply') || end === -1) throw new Error('splat-galaxy : en-tête PLY introuvable.')
  const elements = []
  for (const line of header.slice(0, end).split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'element') elements.push({ name: parts[1], count: Number(parts[2]), properties: [], stride: 0 })
    if (parts[0] === 'property') {
      const element = elements[elements.length - 1]
      element.properties.push(parts[2])
      element.stride += parts[1] === 'uchar' || parts[1] === 'uint8' ? 1 : 4
    }
  }
  const view = new DataView(buffer)
  let offset = end + 'end_header\n'.length
  const offsets = {}
  for (const element of elements) {
    offsets[element.name] = offset
    offset += element.count * element.stride
  }
  const chunk = elements.find((element) => element.name === 'chunk')
  const vertex = elements.find((element) => element.name === 'vertex')
  if (!chunk || !vertex || !vertex.properties.includes('packed_position')) {
    throw new Error('splat-galaxy : ce n\'est pas un PLY compressé.')
  }

  const chunkFloats = chunk.properties.length
  const chunks = new Float32Array(chunk.count * chunkFloats)
  for (let i = 0; i < chunks.length; i++) chunks[i] = view.getFloat32(offsets.chunk + i * 4, true)
  const c = (name) => chunk.properties.indexOf(name)
  const bounds = ['min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z',
    'min_scale_x', 'min_scale_y', 'min_scale_z', 'max_scale_x', 'max_scale_y', 'max_scale_z',
    'min_r', 'min_g', 'min_b', 'max_r', 'max_g', 'max_b'].map(c)
  const hasColorBounds = bounds[12] !== -1
  const field = (name) => vertex.properties.indexOf(name) * 4
  const [oPosition, oRotation, oScale, oColor] = ['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'].map(field)

  const count = vertex.count
  const centers = new Float32Array(count * 3)
  const covariances = new Float32Array(count * 6)
  const colors = new Uint8Array(count * 4)
  const unorm = (value, bits) => (value & ((1 << bits) - 1)) / ((1 << bits) - 1)
  const lerp = (a, b, t) => a + (b - a) * t
  const quaternion = [0, 0, 0, 0]
  const matrix = new THREE.Matrix3()
  const rotation = new THREE.Matrix4()
  const q = new THREE.Quaternion()

  for (let i = 0; i < count; i++) {
    const base = offsets.vertex + i * vertex.stride
    const k = Math.floor(i / CHUNK_SIZE) * chunkFloats
    const b = (index) => chunks[k + bounds[index]]

    const p = view.getUint32(base + oPosition, true)
    centers[i * 3] = lerp(b(0), b(3), unorm(p >>> 21, 11))
    centers[i * 3 + 1] = lerp(b(1), b(4), unorm(p >>> 11, 10))
    centers[i * 3 + 2] = lerp(b(2), b(5), unorm(p, 11))

    // Rotation : les trois plus petites composantes, et 2 bits pour l'indice de la plus grande.
    const r = view.getUint32(base + oRotation, true)
    const small = [r >>> 20, r >>> 10, r].map((value) => (unorm(value, 10) - 0.5) * Math.SQRT2)
    const largest = r >>> 30
    const w = Math.sqrt(Math.max(0, 1 - small[0] ** 2 - small[1] ** 2 - small[2] ** 2))
    for (let j = 0, s = 0; j < 4; j++) quaternion[j] = j === largest ? w : small[s++]
    // quaternion = (w, x, y, z)
    q.set(quaternion[1], quaternion[2], quaternion[3], quaternion[0]).normalize()

    const scale = view.getUint32(base + oScale, true)
    const sx = Math.exp(lerp(b(6), b(9), unorm(scale >>> 21, 11)))
    const sy = Math.exp(lerp(b(7), b(10), unorm(scale >>> 11, 10)))
    const sz = Math.exp(lerp(b(8), b(11), unorm(scale, 11)))

    // Covariance Σ = R S Sᵀ Rᵀ, gardée en 6 valeurs (xx, xy, xz, yy, yz, zz).
    rotation.makeRotationFromQuaternion(q)
    matrix.setFromMatrix4(rotation)
    const e = matrix.elements // colonne par colonne
    const m = [e[0] * sx, e[1] * sx, e[2] * sx, e[3] * sy, e[4] * sy, e[5] * sy, e[6] * sz, e[7] * sz, e[8] * sz]
    const row = (a, bb) => m[a] * m[bb] + m[a + 3] * m[bb + 3] + m[a + 6] * m[bb + 6]
    covariances.set([row(0, 0), row(0, 1), row(0, 2), row(1, 1), row(1, 2), row(2, 2)], i * 6)

    // Couleur déjà en 0.5 + SH_C0 · f_dc (sRGB), opacité déjà passée par la sigmoïde.
    const color = view.getUint32(base + oColor, true)
    let red = unorm(color >>> 24, 8)
    let green = unorm(color >>> 16, 8)
    let blue = unorm(color >>> 8, 8)
    if (hasColorBounds) {
      red = lerp(b(12), b(15), red)
      green = lerp(b(13), b(16), green)
      blue = lerp(b(14), b(17), blue)
    }
    colors.set([red, green, blue, unorm(color, 8)].map((value) => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255)), i * 4)
  }
  return { count, centers, covariances, colors }
}

// Centre moyen et rayon utile (98 % des splats) : quelques splats isolés ne fixent pas l'échelle.
export function measure({ count, centers }) {
  const center = [0, 0, 0]
  for (let i = 0; i < count * 3; i++) center[i % 3] += centers[i] / count
  const distances = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    distances[i] = Math.hypot(centers[i * 3] - center[0], centers[i * 3 + 1] - center[1], centers[i * 3 + 2] - center[2])
  }
  return { center, radius: distances.sort()[Math.floor(count * 0.98)] }
}

// Tri du plus lointain au plus proche de l'origine (le point de vue de la cuisson), une fois les
// splats placés par matrix (éléments d'une Matrix4). Tri par comptage sur 16 bits : rapide, et assez
// fin pour un mélange sans artefact visible. Renvoie des tableaux neufs, prêts pour les attributs.
export function sortFromOrigin({ count, centers, covariances, colors }, matrix) {
  const transform = new THREE.Matrix4().fromArray(matrix)
  const world = new THREE.Vector3()
  const distances = new Float32Array(count)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < count; i++) {
    distances[i] = world.fromArray(centers, i * 3).applyMatrix4(transform).length()
    min = Math.min(min, distances[i])
    max = Math.max(max, distances[i])
  }
  const keys = new Uint32Array(count)
  const counts = new Uint32Array(65536)
  const range = 65535 / Math.max(max - min, 1e-6)
  for (let i = 0; i < count; i++) {
    keys[i] = 65535 - Math.floor((distances[i] - min) * range)
    counts[keys[i]]++
  }
  for (let i = 1; i < 65536; i++) counts[i] += counts[i - 1]
  const order = new Uint32Array(count)
  for (let i = count - 1; i >= 0; i--) order[--counts[keys[i]]] = i

  const sorted = {
    centers: new Float32Array(count * 3),
    covA: new Float32Array(count * 3),
    covB: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
  }
  for (let slot = 0; slot < count; slot++) {
    const i = order[slot]
    sorted.centers.set(centers.subarray(i * 3, i * 3 + 3), slot * 3)
    sorted.covA.set(covariances.subarray(i * 6, i * 6 + 3), slot * 3)
    sorted.covB.set(covariances.subarray(i * 6 + 3, i * 6 + 6), slot * 3)
    sorted.colors.set(colors.subarray(i * 4, i * 4 + 4), slot * 4)
  }
  return sorted
}
