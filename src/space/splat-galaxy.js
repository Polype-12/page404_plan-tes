import * as THREE from 'three'

// Galaxie en « gaussian splatting » (fichier SuperSplat / PlayCanvas *.compressed.ply), inspirée de
// src/galaxy-splatting. Le GaussianSplat de three.js ne tourne qu'en WebGPU : ici, rendu WebGL maison
// (une instance de quad par splat, projection de la covariance 3D en ellipse 2D dans le shader).
// C'est un objet de l'espace comme les autres, dessiné à chaque image : vraie profondeur (les astres
// passent devant ou derrière selon leur distance) et brouillard de la scène. Décodage et tris (du plus
// loin au plus près de la caméra) se font dans un worker (splat-worker.js).

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aCovA;
  attribute vec3 aCovB;
  attribute vec4 aColor;
  uniform vec2 uViewport;
  uniform float uFocal;
  // Part des splats dessinés (0 à 1) et facteur de taille de chaque splat.
  uniform float uFraction;
  uniform float uSplatScale;
  // 0 = ellipses du fichier (souvent fines, comme des traits), 1 = points ronds de même taille moyenne.
  uniform float uRoundness;
  varying vec4 vColor;
  varying vec2 vPosition;
  varying float vFade;
  #include <fog_pars_vertex>
  #include <clipping_planes_pars_vertex>

  void main() {
    vec4 view = modelViewMatrix * vec4(aCenter, 1.0);
    // Plan de coupe de la fenêtre du « 404 » (main_404.js) : un splat est gardé ou coupé en entier.
    #if NUM_CLIPPING_PLANES > 0
      vClipPosition = -view.xyz;
    #endif
    vec4 clip = projectionMatrix * view;
    // Gardé jusqu'à deux fois la largeur du champ : un splat dont le centre est sorti peut encore
    // couvrir le bord de l'écran ; il s'estompe une fois sorti (voir vFade), puis disparaît.
    float bound = 2.0 * clip.w;
    // Tirage stable par splat (d'après sa position, pas son rang, qui change à chaque tri) : la
    // galaxie s'éclaircit uniformément, sans scintiller. Écarté ici, un splat ne coûte aucun pixel.
    float pick = fract(sin(dot(aCenter, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (pick >= uFraction) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    if (view.z > -0.01 || clip.x < -bound || clip.x > bound || clip.y < -bound || clip.y > bound) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    // Fondu : nul dans le champ, il commence quand le centre en sort (bord = 1) et s'achève à 2 ;
    // aussi tout près de la caméra, où un splat devient immense.
    float edge = max(abs(clip.x), abs(clip.y)) / clip.w;
    vFade = (1.0 - smoothstep(1.0, 2.0, edge)) * smoothstep(1.0, 12.0, -view.z);

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
    // Rayon × uSplatScale : la covariance (une aire) est multipliée par son carré.
    projected *= uSplatScale * uSplatScale;
    // Arrondi : l'ellipse se rapproche d'un cercle de même aire moyenne (diagonale moyenne, sans biais).
    float average = 0.5 * (projected[0][0] + projected[1][1]);
    float a = mix(projected[0][0], average, uRoundness) + 0.3;
    float d = mix(projected[1][1], average, uRoundness) + 0.3;
    float b = projected[0][1] * (1.0 - uRoundness);

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
    // Décalage de l'ellipse en espace écran, ramené en coordonnées de découpe : profondeur réelle.
    gl_Position = vec4(clip.xy + (position.x * major + position.y * minor) / uViewport * clip.w, clip.z, clip.w);
    #ifdef USE_FOG
      vFogDepth = -view.z;
    #endif
  }
`

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 uTint;
  varying vec4 vColor;
  varying vec2 vPosition;
  varying float vFade;
  #include <fog_pars_fragment>
  #include <clipping_planes_pars_fragment>

  void main() {
    #include <clipping_planes_fragment>
    float power = -dot(vPosition, vPosition);
    if (power < -4.0) discard;
    float alpha = exp(power) * vColor.a * vFade;
    // Couleurs du fichier en sRGB, ramenées en linéaire puis teintées et atténuées.
    vec3 color = pow(vColor.rgb, vec3(2.2)) * uTint * uIntensity;
    // Brouillard de la scène, comme sur les astres (exponentiel ou linéaire selon scene.fog).
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      color = mix(color, fogColor, fogFactor);
    #endif
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
      uFraction: { value: 1 },
      uSplatScale: { value: 1 },
      uRoundness: { value: 0 },
      uIntensity: { value: 1 },
      uTint: { value: new THREE.Color() },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    fog: true,
    clipping: true,
    transparent: true,
    // Par sécurité : un quad retourné reste dessiné.
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  // Premier des objets transparents : particules et atmosphères se posent par-dessus.
  mesh.renderOrder = -1

  // Un seul tri à la fois ; le dernier demandé pendant un tri en cours est gardé pour la suite.
  let sorting = false
  let pending = null
  let sortId = 0
  const relative = new THREE.Matrix4()
  // Tri par distance à la caméra : les splats sont exprimés dans son repère avant d'être triés.
  function requestSort(camera) {
    if (sorting) {
      pending = camera
      return
    }
    sorting = true
    mesh.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    relative.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    worker.postMessage({ type: 'sort', id: ++sortId, matrix: relative.toArray() })
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
          const camera = pending
          pending = null
          requestSort(camera)
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
    // Taille de l'image rendue (pixels) et angle vertical de la caméra (degrés) : focale en pixels.
    setViewport(width, height, fov) {
      material.uniforms.uViewport.value.set(width, height)
      material.uniforms.uFocal.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
    },
    dispose() {
      worker.terminate()
      geometry.dispose()
      material.dispose()
    },
  }
}
