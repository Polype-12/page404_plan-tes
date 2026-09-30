// Atmosphère à diffusion simple (Rayleigh + Mie), intégrée par lancer de rayons.
// Tout est calculé en rayons planétaires : la même atmosphère fonctionne à toute échelle.

export const atmosphereVertexShader = /* glsl */ `
  uniform float uShellScale;
  varying vec3 vWorldPosition;
  varying vec3 vCenter;
  varying float vRadius;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vRadius = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz) / uShellScale;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const atmosphereFragmentShader = /* glsl */ `
  #define PI 3.141592653589793
  #define PRIMARY_STEPS 16
  #define LIGHT_STEPS 6

  uniform vec3 uSunDirection;
  uniform float uSunIntensity;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uThickness;
  uniform float uDensity;
  uniform float uMie;
  uniform float uMieG;
  varying vec3 vWorldPosition;
  varying vec3 vCenter;
  varying float vRadius;

  // Distances d'entrée et de sortie d'un rayon dans une sphère centrée à l'origine.
  vec2 raySphere(vec3 origin, vec3 direction, float radius) {
    float b = dot(origin, direction);
    float c = dot(origin, origin) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  bool hitsPlanet(vec3 origin, vec3 direction) {
    vec2 hit = raySphere(origin, direction, 1.0);
    return hit.x < hit.y && hit.x > 0.0;
  }

  void main() {
    vec3 origin = (cameraPosition - vCenter) / vRadius;
    vec3 direction = normalize(vWorldPosition - cameraPosition);
    float top = 1.0 + uThickness;

    vec2 atmosphere = raySphere(origin, direction, top);
    vec2 ground = raySphere(origin, direction, 1.0);
    float start = max(atmosphere.x, 0.0);
    float end = atmosphere.y;
    if (ground.x < ground.y && ground.x > 0.0) end = min(end, ground.x);
    if (end <= start) discard;

    // Hauteurs d'échelle : la densité tombe à ~e^-5.5 au sommet de l'atmosphère.
    float scaleRayleigh = uThickness * 0.18;
    float scaleMie = scaleRayleigh * 0.2;
    // Épaisseurs optiques verticales proches de la Terre pour uColor bleu et uDensity = 1.
    vec3 betaRayleigh = uColor * 0.18 * uDensity / scaleRayleigh;
    vec3 betaMie = vec3(0.02 * uMie * uDensity / scaleMie);
    vec3 extinctionMie = betaMie * 1.1;

    float stepSize = (end - start) / float(PRIMARY_STEPS);
    vec3 sumRayleigh = vec3(0.0);
    vec3 sumMie = vec3(0.0);
    float depthRayleigh = 0.0;
    float depthMie = 0.0;

    for (int i = 0; i < PRIMARY_STEPS; i++) {
      vec3 samplePoint = origin + direction * (start + (float(i) + 0.5) * stepSize);
      float height = max(length(samplePoint) - 1.0, 0.0);
      float densityRayleigh = exp(-height / scaleRayleigh) * stepSize;
      float densityMie = exp(-height / scaleMie) * stepSize;
      depthRayleigh += densityRayleigh;
      depthMie += densityMie;

      // Côté nuit : la planète masque le Soleil, ce point ne diffuse rien.
      if (hitsPlanet(samplePoint, uSunDirection)) continue;

      float lightStep = raySphere(samplePoint, uSunDirection, top).y / float(LIGHT_STEPS);
      float lightRayleigh = 0.0;
      float lightMie = 0.0;
      for (int j = 0; j < LIGHT_STEPS; j++) {
        vec3 lightPoint = samplePoint + uSunDirection * ((float(j) + 0.5) * lightStep);
        float lightHeight = max(length(lightPoint) - 1.0, 0.0);
        lightRayleigh += exp(-lightHeight / scaleRayleigh) * lightStep;
        lightMie += exp(-lightHeight / scaleMie) * lightStep;
      }

      vec3 attenuation = exp(
        -(betaRayleigh * (depthRayleigh + lightRayleigh) + extinctionMie * (depthMie + lightMie))
      );
      sumRayleigh += densityRayleigh * attenuation;
      sumMie += densityMie * attenuation;
    }

    float mu = dot(direction, uSunDirection);
    float phaseRayleigh = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = uMieG;
    float phaseMie = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu))
      / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

    vec3 scattered = (sumRayleigh * betaRayleigh * phaseRayleigh + sumMie * betaMie * phaseMie)
      * uIntensity * uSunIntensity;
    // Lumière uniquement ajoutée : la surface n'est jamais assombrie au limbe.
    gl_FragColor = vec4(scattered, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
