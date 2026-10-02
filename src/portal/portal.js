import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { CHAMFER, createGlass404, GLASS, HALO_LAYER } from './glass404.js'

// Le « 404 » est une fenêtre sur l'espace, comme les faces d'une « impossible box » : l'espace est
// rendu par une caméra qui suit exactement la caméra du portail, puis peint sur les faces des chiffres
// à l'endroit de l'écran où il a été rendu. Parallaxe réelle, et aucun fondu : quand une face remplit
// l'écran, l'image est identique à l'espace plein écran.
const windowVertexShader = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const windowFragmentShader = /* glsl */ `
  uniform sampler2D uSpace;
  uniform vec2 uResolution;
  void main() {
    gl_FragColor = vec4(texture2D(uSpace, gl_FragCoord.xy / uResolution).rgb, 1.0);
    #include <colorspace_fragment>
  }
`

const quadVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Halo des reflets : seuls les reflets du verre (les blancs de l'HDR) sont rendus dans une petite
// texture (1/4 de la résolution), les faces « fenêtre » ne servant qu'à les masquer. Les parties les
// plus vives sont gardées, floutées, puis ajoutées par-dessus le « 404 » comme de la lumière : elles
// débordent sur les faces sombres. Sur le blanc du CSS, une lumière ajoutée reste invisible.
// strength : intensité. radius : étalement du flou. threshold : seuil de luminosité des reflets
// retenus. tint / color : part d'une couleur fixe (0 = couleur des reflets, 1 = color).
export const HALO = { strength: 1.5, radius: 1.6, threshold: 0.25, tint: 0, color: '#ffffff' }
const HALO_SCALE = 4
const HALO_PASSES = 3

const brightFragmentShader = /* glsl */ `
  uniform sampler2D uInput;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(max(texture2D(uInput, vUv).rgb - uThreshold, 0.0), 1.0);
  }
`

const blurFragmentShader = /* glsl */ `
  uniform sampler2D uInput;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    // Gaussienne sur 9 échantillons, séparable (horizontal puis vertical).
    vec4 sum = texture2D(uInput, vUv) * 0.2270270270;
    sum += (texture2D(uInput, vUv + uStep * 1.0) + texture2D(uInput, vUv - uStep * 1.0)) * 0.1945945946;
    sum += (texture2D(uInput, vUv + uStep * 2.0) + texture2D(uInput, vUv - uStep * 2.0)) * 0.1216216216;
    sum += (texture2D(uInput, vUv + uStep * 3.0) + texture2D(uInput, vUv - uStep * 3.0)) * 0.0540540541;
    sum += (texture2D(uInput, vUv + uStep * 4.0) + texture2D(uInput, vUv - uStep * 4.0)) * 0.0162162162;
    gl_FragColor = sum;
  }
`

const haloFragmentShader = /* glsl */ `
  uniform sampler2D uInput;
  uniform float uStrength;
  uniform float uTint;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec3 glow = texture2D(uInput, vUv).rgb;
    float level = max(glow.r, max(glow.g, glow.b));
    gl_FragColor = vec4(mix(glow, uColor * level, uTint) * uStrength, 0.0);
  }
`

const uvQuadVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Occlusion ambiante (SSAO) du sol : le canevas est transparent, un SSAO plein écran classique (qui
// assombrit des pixels existants) ne pourrait pas toucher le sol, qui n'en a pas. L'occlusion est donc
// calculée sur le sol lui-même : chaque point du sol sonde une demi-sphère au-dessus de lui contre la
// profondeur des chiffres (rendue à mi-résolution), et s'assombrit là où ils la masquent : contact
// net au pied des lettres, qui s'efface en s'éloignant.
// strength : opacité maximale. radius : rayon de la sonde (unités du monde).
export const AO = { strength: 0.41, radius: 1 }
const AO_SAMPLES = 16
const AO_SCALE = 2

const aoVertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const aoFragmentShader = /* glsl */ `
  #include <packing>
  uniform sampler2D uDepth;
  uniform mat4 uViewProjection;
  uniform mat4 uView;
  uniform float uNear;
  uniform float uFar;
  uniform float uRadius;
  uniform float uStrength;
  uniform vec3 uKernel[${AO_SAMPLES}];
  varying vec3 vWorld;

  void main() {
    // Rotation de la sonde propre à chaque pixel (bruit à gradient entrelacé) : pas de motif visible.
    float angle = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    mat2 rotation = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    float occlusion = 0.0;
    for (int i = 0; i < ${AO_SAMPLES}; i++) {
      vec3 offset = uKernel[i];
      offset.xz = rotation * offset.xz;
      vec3 point = vWorld + offset * uRadius;
      vec4 clip = uViewProjection * vec4(point, 1.0);
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
      float stored = texture2D(uDepth, uv).x;
      if (stored >= 1.0) continue;
      float surface = -perspectiveDepthToViewZ(stored, uNear, uFar);
      float depth = -(uView * vec4(point, 1.0)).z;
      // Une lettre devant le point le masque ; trop loin devant, elle ne compte plus.
      float range = smoothstep(0.0, 1.0, uRadius / abs(depth - surface));
      occlusion += step(surface, depth - 0.02) * range;
    }
    gl_FragColor = vec4(0.0, 0.0, 0.0, occlusion / float(${AO_SAMPLES}) * uStrength);
  }
`

// Environnement HDR (Poly Haven, CC0) pour les reflets du verre ; il n'éclaire rien d'autre.
const ENVIRONMENT = 'env/studio_small_09_1k.hdr'

export function createPortal({ renderer, camera, getSpaceTexture }) {
  // Studio blanc : pas de fond dans la scène, le blanc vient du CSS (canevas transparent). Le
  // brouillard blanc estompe l'ombre du sol au loin.
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#ffffff', 30, 90)

  const uniforms = {
    uSpace: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
  }
  const windowMaterial = new THREE.ShaderMaterial({
    vertexShader: windowVertexShader,
    fragmentShader: windowFragmentShader,
    uniforms,
  })
  const glass = createGlass404(windowMaterial)
  scene.add(glass.group)

  const pmrem = new THREE.PMREMGenerator(renderer)
  let environment = null
  let disposed = false
  new HDRLoader().load(`${import.meta.env.BASE_URL}${ENVIRONMENT}`, (hdr) => {
    if (!disposed) {
      environment = pmrem.fromEquirectangular(hdr)
      glass.material.envMap = environment.texture
      glass.material.needsUpdate = true
    }
    hdr.dispose()
    pmrem.dispose()
  })

  // Sol au ras du « 404 » : il ne dessine que l'ombre, posée sur le blanc du CSS.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.3 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = glass.bottomY
  ground.receiveShadow = true
  scene.add(ground)

  // Occlusion ambiante, sur un second plan juste au-dessus du sol (voir AO).
  const ao = { ...AO }
  const aoTarget = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) })
  // Demi-sphère d'échantillons, resserrée près du centre : le contact pèse plus que le lointain.
  const kernel = Array.from({ length: AO_SAMPLES }, (_, index) => {
    const sample = new THREE.Vector3(Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1).normalize()
    const t = index / AO_SAMPLES
    return sample.multiplyScalar(THREE.MathUtils.lerp(0.1, 1, t * t) * Math.random())
  })
  const aoMaterial = new THREE.ShaderMaterial({
    vertexShader: aoVertexShader,
    fragmentShader: aoFragmentShader,
    uniforms: {
      uDepth: { value: aoTarget.depthTexture },
      uViewProjection: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uRadius: { value: 1 },
      uStrength: { value: 1 },
      uKernel: { value: kernel },
    },
    transparent: true,
    depthWrite: false,
  })
  const aoGround = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), aoMaterial)
  aoGround.rotation.x = -Math.PI / 2
  aoGround.renderOrder = 2
  scene.add(aoGround)

  function placeGround() {
    ground.position.y = glass.bottomY
    aoGround.position.y = glass.bottomY + 0.002
  }
  placeGround()

  // Lumière principale en haut à gauche, devant : ombre portée vers l'arrière-droite.
  const light = new THREE.DirectionalLight('#ffffff', 2.2)
  light.position.set(-6, 12, 9)
  light.castShadow = true
  // Ombre diffuse : filtrage PCF sur un grand rayon (en texels de la carte d'ombre, ici ~0,3 unité),
  // et un peu transparente, comme sous un ciel couvert de studio.
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.radius = 14
  light.shadow.intensity = 0.7
  const shadowCamera = light.shadow.camera
  shadowCamera.left = shadowCamera.bottom = -11
  shadowCamera.right = shadowCamera.top = 11
  shadowCamera.near = 1
  shadowCamera.far = 40
  light.shadow.bias = -0.001
  light.shadow.normalBias = 0.03
  // Lumière d'ambiance ciel/sol : les ombres restent grises, jamais noires.
  const fill = new THREE.HemisphereLight('#ffffff', '#d8d8d8', 1.6)
  scene.add(light, fill)

  // Espace plein écran, une fois la fenêtre franchie : même shader, mêmes pixels.
  const quadScene = new THREE.Scene()
  const quadMaterial = new THREE.ShaderMaterial({
    vertexShader: quadVertexShader,
    fragmentShader: windowFragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial)
  quad.frustumCulled = false
  quadScene.add(quad)
  const quadCamera = new THREE.OrthographicCamera()

  // Halo : deux textures en alternance pour le flou, une scène plein écran par passe.
  const halo = { ...HALO }
  const haloTargets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader: uvQuadVertexShader,
    fragmentShader: blurFragmentShader,
    uniforms: { uInput: { value: null }, uStep: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  })
  const brightMaterial = new THREE.ShaderMaterial({
    vertexShader: uvQuadVertexShader,
    fragmentShader: brightFragmentShader,
    uniforms: { uInput: { value: null }, uThreshold: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  })
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: uvQuadVertexShader,
    fragmentShader: haloFragmentShader,
    uniforms: {
      uInput: { value: haloTargets[0].texture },
      uStrength: { value: 1 },
      uTint: { value: 0 },
      uColor: { value: new THREE.Color() },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // Lumière ajoutée ; la transparence du canevas (alpha) n'est pas touchée.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  const passScene = new THREE.Scene()
  const pass = new THREE.Mesh(quad.geometry, blurMaterial)
  pass.frustumCulled = false
  passScene.add(pass)
  const clearColor = new THREE.Color()

  function drawPass(material, target) {
    pass.material = material
    renderer.setRenderTarget(target)
    renderer.render(passScene, quadCamera)
  }

  // Profondeur des chiffres seuls, pour l'occlusion du sol.
  function prepareAo() {
    const layers = camera.layers.mask
    camera.layers.set(HALO_LAYER)
    windowMaterial.colorWrite = false
    const shadowUpdate = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(aoTarget)
    renderer.render(scene, camera)
    renderer.shadowMap.autoUpdate = shadowUpdate
    windowMaterial.colorWrite = true
    camera.layers.mask = layers

    const { uniforms: aoUniforms } = aoMaterial
    aoUniforms.uView.value.copy(camera.matrixWorldInverse)
    aoUniforms.uViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    aoUniforms.uNear.value = camera.near
    aoUniforms.uFar.value = camera.far
    aoUniforms.uRadius.value = ao.radius
    aoUniforms.uStrength.value = ao.strength
  }

  // Prépare le halo dans les petites textures (le résultat finit dans haloTargets[0]).
  function prepareHalo() {
    const [a, b] = haloTargets
    // Source : les reflets seuls ; les faces « fenêtre » n'écrivent que leur profondeur, pour masquer
    // les reflets cachés derrière. L'ombre n'est pas recalculée.
    const layers = camera.layers.mask
    camera.layers.set(HALO_LAYER)
    windowMaterial.colorWrite = false
    const shadowUpdate = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(a)
    renderer.render(scene, camera)
    renderer.shadowMap.autoUpdate = shadowUpdate
    windowMaterial.colorWrite = true
    camera.layers.mask = layers

    // Seuil : seuls les blancs vifs des reflets débordent.
    brightMaterial.uniforms.uInput.value = a.texture
    brightMaterial.uniforms.uThreshold.value = halo.threshold
    drawPass(brightMaterial, b)
    blurMaterial.uniforms.uInput.value = b.texture
    blurMaterial.uniforms.uStep.value.set(0, 0)
    drawPass(blurMaterial, a)

    for (let i = 0; i < HALO_PASSES; i++) {
      // Chaque passe s'étale davantage : flou large pour un coût fixe.
      const spread = halo.radius * (i + 1)
      blurMaterial.uniforms.uInput.value = a.texture
      blurMaterial.uniforms.uStep.value.set(spread / a.width, 0)
      drawPass(blurMaterial, b)
      blurMaterial.uniforms.uInput.value = b.texture
      blurMaterial.uniforms.uStep.value.set(0, spread / a.height)
      drawPass(blurMaterial, a)
    }

    haloMaterial.uniforms.uStrength.value = halo.strength
    haloMaterial.uniforms.uTint.value = halo.tint
    haloMaterial.uniforms.uColor.value.set(halo.color)
  }

  return {
    frontZ: glass.frontZ,
    bottomY: glass.bottomY,
    entryX: glass.entryX,
    // inside : vrai une fois la fenêtre franchie, l'espace occupe tout l'écran.
    // Intensité des reflets, réglable dans le panneau (valeur par défaut : GLASS dans glass404.js).
    glass: { reflections: GLASS.reflections },
    // Réglages du halo, modifiables dans le panneau (valeurs par défaut : HALO).
    halo,
    // Réglages de l'occlusion du sol (valeurs par défaut : AO).
    ao,
    // Largeur du chanfrein (valeur par défaut : CHAMFER dans glass404.js) ; le sol suit les chiffres.
    chamfer: { chamfer: CHAMFER.chamfer },
    setChamfer(value) {
      glass.setChamfer(value)
      placeGround()
    },
    // Chanfrein actuellement construit (pour éviter de reconstruire à l'identique).
    get glassChamfer() {
      return glass.chamfer
    },
    // dive : avancement de la plongée (0 à 1) ; les reflets s'estompent à l'approche du « 404 » et
    // ont disparu au passage, pour que l'image soit déjà celle de l'espace seul.
    render(inside, dive = 0) {
      uniforms.uSpace.value = getSpaceTexture()
      const reflections = 1 - THREE.MathUtils.smoothstep(dive, 0.45, 0.95)
      glass.material.envMapIntensity = this.glass.reflections * reflections
      glass.material.specularIntensity = reflections
      if (inside) {
        renderer.render(quadScene, quadCamera)
        return
      }
      // Fond transparent le temps du « 404 » : chiffres et ombre, puis le halo des reflets par-dessus.
      renderer.getClearColor(clearColor)
      const clearAlpha = renderer.getClearAlpha()
      renderer.setClearColor(0x000000, 0)
      prepareHalo()
      prepareAo()
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)
      renderer.autoClear = false
      drawPass(haloMaterial, null)
      renderer.autoClear = true
      renderer.setClearColor(clearColor, clearAlpha)
    },
    setSize() {
      renderer.getDrawingBufferSize(uniforms.uResolution.value)
      const { x, y } = uniforms.uResolution.value
      for (const target of haloTargets) target.setSize(Math.max(1, Math.round(x / HALO_SCALE)), Math.max(1, Math.round(y / HALO_SCALE)))
      aoTarget.setSize(Math.max(1, Math.round(x / AO_SCALE)), Math.max(1, Math.round(y / AO_SCALE)))
    },
    dispose() {
      disposed = true
      environment?.dispose()
      glass.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      light.dispose()
      windowMaterial.dispose()
      quadMaterial.dispose()
      quad.geometry.dispose()
      for (const target of haloTargets) target.dispose()
      aoTarget.depthTexture.dispose()
      aoTarget.dispose()
      aoGround.geometry.dispose()
      aoMaterial.dispose()
      blurMaterial.dispose()
      brightMaterial.dispose()
      haloMaterial.dispose()
    },
  }
}
