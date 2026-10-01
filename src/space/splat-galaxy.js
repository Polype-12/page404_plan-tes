import * as THREE from 'three'

// Galaxie en « gaussian splatting » (fichier SuperSplat / PlayCanvas *.compressed.ply), inspirée de
// src/galaxy-splatting. Le GaussianSplat de three.js ne tourne qu'en WebGPU : ici, rendu WebGL maison
// (une instance de quad par splat, projection de la covariance 3D en ellipse 2D dans le shader).
// Elle n'est dessinée qu'au moment de cuire le fond (galaxy.js), jamais à chaque image. Décodage et
// tris se font dans un worker (splat-worker.js) : la page ne fige jamais.

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aCovA;
  attribute vec3 aCovB;
  attribute vec4 aColor;
  uniform vec2 uViewport;
  uniform float uFocal;
  varying vec4 vColor;
  varying vec2 vPosition;

  void main() {
    vec4 view = modelViewMatrix * vec4(aCenter, 1.0);
    vec4 clip = projectionMatrix * view;
    float bound = 1.2 * clip.w;
    if (view.z > -0.01 || clip.x < -bound || clip.x > bound || clip.y < -bound || clip.y > bound) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    // Covariance projetée à l'écran : Σ' = J W Σ Wᵀ Jᵀ (la caméra regarde vers -z).
    mat3 sigma = mat3(aCovA.x, aCovA.y, aCovA.z, aCovA.y, aCovB.x, aCovB.y, aCovA.z, aCovB.y, aCovB.z);
    float depth = -view.z;
    mat3 J = mat3(
      uFocal / depth, 0.0, uFocal * view.x / (depth * depth),
      0.0, uFocal / depth, uFocal * view.y / (depth * depth),
      0.0, 0.0, 0.0
    );
    mat3 T = transpose(mat3(modelViewMatrix)) * J;
    mat3 projected = transpose(T) * sigma * T;
    // Léger flou (0,3 px²) : aucune ellipse plus fine qu'un pixel.
    float a = projected[0][0] + 0.3;
    float d = projected[1][1] + 0.3;
    float b = projected[0][1];

    float mid = 0.5 * (a + d);
    float radius = length(vec2(0.5 * (a - d), b));
    float lambda1 = mid + radius;
    float lambda2 = max(mid - radius, 0.1);
    vec2 axis = normalize(vec2(b, lambda1 - a));
    vec2 major = min(sqrt(2.0 * lambda1), 512.0) * axis;
    // Axe mineur tourné de +90° : le repère (majeur, mineur) reste direct, le quad reste face caméra.
    vec2 minor = min(sqrt(2.0 * lambda2), 512.0) * vec2(-axis.y, axis.x);

    vColor = aColor;
    vPosition = position.xy;
    vec2 center = clip.xy / clip.w;
    gl_Position = vec4(center + (position.x * major + position.y * minor) / uViewport, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 uTint;
  varying vec4 vColor;
  varying vec2 vPosition;

  void main() {
    float power = -dot(vPosition, vPosition);
    if (power < -4.0) discard;
    float alpha = exp(power) * vColor.a;
    // Couleurs du fichier en sRGB, ramenées en linéaire puis teintées et atténuées.
    vec3 color = pow(vColor.rgb, vec3(2.2)) * uTint * uIntensity;
    // Prémultiplié : mélange ONE / ONE_MINUS_SRC_ALPHA, du plus lointain au plus proche.
    gl_FragColor = vec4(color * alpha, alpha);
  }
`

// Charge la galaxie ; onSorted est appelé à chaque tri terminé (le fond peut alors être recuit).
export function loadSplatGalaxy(url, { onSorted = () => {} } = {}) {
  const worker = new Worker(new URL('./splat-worker.js', import.meta.url), { type: 'module' })
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.instanceCount = 0

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uFocal: { value: 1 },
      uIntensity: { value: 1 },
      uTint: { value: new THREE.Color() },
    },
    transparent: true,
    // Par sécurité : un quad retourné reste dessiné.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 1

  // Un seul tri à la fois ; le dernier demandé pendant un tri en cours est gardé pour la suite.
  let sorting = false
  let pending = null
  let sortId = 0
  function requestSort() {
    if (sorting) {
      pending = true
      return
    }
    sorting = true
    mesh.updateWorldMatrix(true, false)
    worker.postMessage({ type: 'sort', id: ++sortId, matrix: mesh.matrixWorld.toArray() })
  }

  const loaded = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') {
        reject(new Error(data.message))
      } else if (data.type === 'loaded') {
        resolve({ center: new THREE.Vector3().fromArray(data.center), radius: data.radius })
      } else if (data.type === 'sorted') {
        const attributes = {
          aCenter: new THREE.InstancedBufferAttribute(data.centers, 3),
          aCovA: new THREE.InstancedBufferAttribute(data.covA, 3),
          aCovB: new THREE.InstancedBufferAttribute(data.covB, 3),
          aColor: new THREE.InstancedBufferAttribute(data.colors, 4, true),
        }
        for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute)
        geometry.instanceCount = data.centers.length / 3
        sorting = false
        if (pending) {
          pending = null
          requestSort()
        } else {
          onSorted()
        }
      }
    }
  })
  worker.postMessage({ type: 'load', url: new URL(url, window.location.href).href })

  return {
    mesh,
    loaded,
    requestSort,
    // Résolution d'une face de la texture cube (angle de 90°) : focale en pixels.
    setResolution(size) {
      material.uniforms.uViewport.value.set(size, size)
      material.uniforms.uFocal.value = size / 2
    },
    dispose() {
      worker.terminate()
      geometry.dispose()
      material.dispose()
    },
  }
}
