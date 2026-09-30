import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createGlass404 } from './glass404.js'

// Le « 404 » est une fenêtre sur l'espace : l'image de l'espace (texture) est peinte en fond,
// limitée à la silhouette des chiffres ; le verre, transparent, ajoute ses reflets par-dessus.
const quadVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const quadFragmentShader = /* glsl */ `
  uniform sampler2D uSpace;
  uniform sampler2D uMask;
  uniform float uEnter;
  varying vec2 vUv;
  void main() {
    // uEnter = 1 : la silhouette disparaît, l'espace occupe tout l'écran.
    float mask = mix(texture2D(uMask, vUv).r, 1.0, uEnter);
    gl_FragColor = vec4(texture2D(uSpace, vUv).rgb * mask, 1.0);
    #include <colorspace_fragment>
  }
`

export function createPortal({ renderer, camera, getSpaceTexture }) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#000000')

  // Reflets d'un studio : sur fond noir, c'est ce qui dessine le verre.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04)
  pmrem.dispose()

  const glass = createGlass404()
  glass.material.envMap = environment.texture
  scene.add(glass.group)

  const maskTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4 })
  const maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })

  const quadMaterial = new THREE.ShaderMaterial({
    vertexShader: quadVertexShader,
    fragmentShader: quadFragmentShader,
    uniforms: {
      uSpace: { value: null },
      uMask: { value: maskTarget.texture },
      uEnter: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial)
  quad.frustumCulled = false
  quad.renderOrder = -1
  scene.add(quad)

  const size = new THREE.Vector2()

  return {
    // enter : 0 = vue du « 404 » seul, 1 = espace plein écran, le verre s'efface.
    render(enter, time, sway = 1) {
      const fade = 1 - enter
      glass.material.envMapIntensity = glass.baseEnvIntensity * fade
      glass.material.clearcoat = glass.baseClearcoat * fade
      glass.group.visible = enter < 1
      glass.group.rotation.y = Math.sin(time * 0.35) * 0.12 * fade * sway

      // Silhouette des chiffres, vue par la même caméra.
      quad.visible = false
      scene.overrideMaterial = maskMaterial
      renderer.setRenderTarget(maskTarget)
      renderer.render(scene, camera)
      scene.overrideMaterial = null
      quad.visible = true
      renderer.setRenderTarget(null)

      quadMaterial.uniforms.uSpace.value = getSpaceTexture()
      quadMaterial.uniforms.uEnter.value = enter
      renderer.render(scene, camera)
    },
    setSize() {
      renderer.getDrawingBufferSize(size)
      maskTarget.setSize(size.x, size.y)
    },
    dispose() {
      glass.dispose()
      environment.dispose()
      maskTarget.dispose()
      maskMaterial.dispose()
      quadMaterial.dispose()
      quad.geometry.dispose()
    },
  }
}
