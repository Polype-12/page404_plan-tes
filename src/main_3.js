import './radar.css';
import * as THREE from 'three';

document.querySelector('#app').innerHTML = `
  <section class="radar-panel" aria-label="Erreur 404 — radar">
    <div class="radar">
      <div class="radar-grid" aria-hidden="true"></div>
      <div class="radar-ticks" aria-hidden="true"></div>
      <div class="radar-bearings" aria-hidden="true">
        <span class="bearing-north">000°</span>
        <span class="bearing-east">090°</span>
        <span class="bearing-south">180°</span>
        <span class="bearing-west">270°</span>
      </div>
      ${[20, 40, 60, 80].map(size => `
        <div class="radar-ring" style="width: ${size}%" aria-hidden="true"></div>
      `).join('')}
      <div class="radar-trail" aria-hidden="true"></div>
      <div class="radar-message">
        <h1>404</h1>
        <p>page not found</p>
      </div>
      <div class="radar-sweep" aria-hidden="true"></div>
    </div>
  </section>
  <aside class="controls" aria-label="Réglages du radar">
    <div class="blue-panel"><div class="blue-circle" role="img" aria-label="La Terre en trois dimensions"></div></div>
    <div class="settings">
      <input id="speed" type="range" min="1" max="10" value="6"
        aria-label="Vitesse du radar" />
      <input id="intensity" type="range" min="20" max="100" value="40"
        aria-label="Intensité du radar" />
      <div class="grey-block" aria-hidden="true"></div>
    </div>
  </aside>
`;

const radar = document.querySelector('.radar');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
// One shared angle keeps the beam, trail and text reveal synchronized.
const rotation = radar.animate(
  [{ '--scan-angle': '47deg' }, { '--scan-angle': '407deg' }],
  { duration: 6000, iterations: Infinity },
);

function updateMotion() {
  if (motionPreference.matches) rotation.pause();
  else rotation.play();
}
updateMotion();
motionPreference.addEventListener('change', updateMotion);

const earthContainer = document.querySelector('.blue-circle');
const earthPanel = document.querySelector('.blue-panel');
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
camera.position.z = 3.6;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
earthPanel.appendChild(renderer.domElement);

const earthTexture = new THREE.TextureLoader().load(
  `${import.meta.env.BASE_URL}terre_texture.jpg`,
);
earthTexture.colorSpace = THREE.SRGBColorSpace;
earthTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const geometry = new THREE.SphereGeometry(1, 64, 32);
const material = new THREE.MeshStandardMaterial({
  map: earthTexture,
  roughness: 1,
  metalness: 0,
});
const earth = new THREE.Mesh(geometry, material);
scene.add(earth);
scene.add(new THREE.AmbientLight(0xffffff, 1.3));
const sunlight = new THREE.DirectionalLight(0xffffff, 2.5);
sunlight.position.set(-3, 2, 4);
scene.add(sunlight);

// A soft atmospheric halo, drawn behind the globe without a postprocessing pass.
const haloGeometry = new THREE.PlaneGeometry(2.5, 2.5);
const haloMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {},
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    void main() {
      float radius = length((vUv - 0.5) * 2.5);
      float glow = exp(-pow((radius - 0.98) / 0.09, 2.0)) * 0.28;
      gl_FragColor = vec4(0.35, 0.65, 1.0, glow);
    }
  `,
});
const halo = new THREE.Mesh(haloGeometry, haloMaterial);
halo.position.z = -1.1;
scene.add(halo);

const starCoordinates = Array.from({ length: 90 }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1]);
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCoordinates.length * 3);
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 1.5,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.75,
  depthWrite: false,
});
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

const earthResizeObserver = new ResizeObserver(() => {
  const { width, height } = earthPanel.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  // Preserve the globe's original size while filling the entire panel with stars.
  const globeSize = earthContainer.getBoundingClientRect().width * 0.93;
  if (!globeSize) return;
  camera.left = -width / globeSize;
  camera.right = width / globeSize;
  camera.top = height / globeSize;
  camera.bottom = -height / globeSize;
  camera.updateProjectionMatrix();
  starCoordinates.forEach(([x, y], index) => {
    starPositions.set([x * camera.right, y * camera.top, -2], index * 3);
  });
  starGeometry.attributes.position.needsUpdate = true;
  starGeometry.computeBoundingSphere();
});
earthResizeObserver.observe(earthPanel);
earthResizeObserver.observe(earthContainer);

const earthCanvas = renderer.domElement;
const pointerEvents = new AbortController();
const pointerOptions = { signal: pointerEvents.signal };
const horizontalAxis = new THREE.Vector3(0, 1, 0);
const verticalAxis = new THREE.Vector3(1, 0, 0);
let drag = null;

earthCanvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || drag) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  earthCanvas.setPointerCapture(event.pointerId);
  earthCanvas.classList.add('is-dragging');
}, pointerOptions);

earthCanvas.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const sensitivity = Math.PI / Math.max(earthContainer.clientWidth, 1);
  earth.rotateOnWorldAxis(horizontalAxis, (event.clientX - drag.x) * sensitivity);
  earth.rotateOnWorldAxis(verticalAxis, (event.clientY - drag.y) * sensitivity);
  drag.x = event.clientX;
  drag.y = event.clientY;
}, pointerOptions);

function endDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  drag = null;
  earthCanvas.classList.remove('is-dragging');
  if (earthCanvas.hasPointerCapture(event.pointerId)) {
    earthCanvas.releasePointerCapture(event.pointerId);
  }
}
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  earthCanvas.addEventListener(eventName, endDrag, pointerOptions);
}

let previousFrame;
renderer.setAnimationLoop((time) => {
  const delta = previousFrame === undefined ? 0 : Math.min((time - previousFrame) / 1000, 0.1);
  previousFrame = time;
  // One full rotation every three minutes, independent of frame rate.
  if (!motionPreference.matches && !drag) earth.rotateY(delta * (Math.PI * 2 / 180));
  renderer.render(scene, camera);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pointerEvents.abort();
    earthResizeObserver.disconnect();
    renderer.setAnimationLoop(null);
    geometry.dispose();
    material.dispose();
    earthTexture.dispose();
    haloGeometry.dispose();
    haloMaterial.dispose();
    starGeometry.dispose();
    starMaterial.dispose();
    renderer.dispose();
    rotation.cancel();
    motionPreference.removeEventListener('change', updateMotion);
  });
}

document.querySelector('#speed').addEventListener('input', (event) => {
  rotation.updatePlaybackRate(Number(event.target.value) / 6);
});

document.querySelector('#intensity').addEventListener('input', (event) => {
  document.querySelector('.radar').style.backgroundColor =
    `hsl(76 78% ${26 + Number(event.target.value) * 0.25}%)`;
});
