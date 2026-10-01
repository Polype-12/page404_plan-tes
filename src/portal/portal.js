import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { createGlass404, GLASS } from './glass404.js'

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

// Environnement HDR (Poly Haven, CC0) pour les reflets du verre ; il n'éclaire rien d'autre.
const ENVIRONMENT = 'env/studio_small_09_1k.hdr'

export function createPortal({ renderer, camera, getSpaceTexture }) {
  // Studio blanc : le sol se fond dans le fond grâce à un brouillard de même couleur.
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#ffffff')
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

  // Sol blanc au ras du « 404 », qui reçoit son ombre.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = glass.bottomY
  ground.receiveShadow = true
  scene.add(ground)

  // Lumière principale en haut à gauche, devant : ombre portée vers l'arrière-droite.
  const light = new THREE.DirectionalLight('#ffffff', 2.2)
  light.position.set(-6, 12, 9)
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  const shadowCamera = light.shadow.camera
  shadowCamera.left = shadowCamera.bottom = -14
  shadowCamera.right = shadowCamera.top = 14
  shadowCamera.near = 1
  shadowCamera.far = 40
  light.shadow.bias = -0.0005
  light.shadow.normalBias = 0.02
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

  return {
    frontZ: glass.frontZ,
    bottomY: glass.bottomY,
    entryX: glass.entryX,
    // inside : vrai une fois la fenêtre franchie, l'espace occupe tout l'écran.
    // Intensité des reflets, réglable dans le panneau (valeur par défaut : GLASS dans glass404.js).
    glass: { reflections: GLASS.reflections },
    // dive : avancement de la plongée (0 à 1) ; les reflets s'estompent à l'approche du « 404 » et
    // ont disparu au passage, pour que l'image soit déjà celle de l'espace seul.
    render(inside, dive = 0) {
      uniforms.uSpace.value = getSpaceTexture()
      const reflections = 1 - THREE.MathUtils.smoothstep(dive, 0.45, 0.95)
      glass.material.envMapIntensity = this.glass.reflections * reflections
      glass.material.specularIntensity = reflections
      if (inside) renderer.render(quadScene, quadCamera)
      else renderer.render(scene, camera)
    },
    setSize() {
      renderer.getDrawingBufferSize(uniforms.uResolution.value)
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
    },
  }
}
