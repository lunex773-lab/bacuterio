import * as THREE from 'three';
import { NOISE_GLSL } from './materials/ShaderChunks';

export const FOG_COLOR = new THREE.Color('#06161d');

/**
 * The intestinal mucus surface, the lumen backdrop, suspended particulates and lighting.
 * Everything here is presentational: it does not feed back into the simulation.
 */
export class EnvironmentView {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  private readonly uniforms = { uTime: { value: 0 } };
  private readonly motes: THREE.Points;
  private readonly moteMat: THREE.ShaderMaterial;
  private readonly roi: THREE.LineSegments;

  constructor(sizeX: number, sizeY: number, sizeZ: number, quality: 'high' | 'medium' | 'low', shadows: boolean) {
    // ---------------------------------------------------------------- lights
    const hemi = new THREE.HemisphereLight('#8fdcff', '#3a1020', 0.6);
    this.group.add(hemi);
    this.key = new THREE.DirectionalLight('#e8fbff', 2.4);
    this.key.position.set(-30, 80, 25);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = shadows;
    if (shadows) {
      const s = this.key.shadow;
      s.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
      const c = s.camera as THREE.OrthographicCamera;
      c.left = -sizeX * 0.62;
      c.right = sizeX * 0.62;
      c.top = sizeZ * 0.62;
      c.bottom = -sizeZ * 0.62;
      c.near = 10;
      c.far = 140 + sizeY * 2;
      s.bias = -0.0004;
      s.normalBias = 0.02;
      s.radius = 3;
    }
    this.group.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight('#ff9a7a', 0.55);
    rim.position.set(40, 12, -50);
    this.group.add(rim);
    const under = new THREE.PointLight('#ff6f8f', 14, 90, 1.6);
    under.position.set(0, -6, 0);
    this.group.add(under);

    // ----------------------------------------------------------------- floor
    const seg = quality === 'low' ? 120 : 220;
    const floorGeo = new THREE.PlaneGeometry(420, 420, seg, seg);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#5c1d2c', roughness: 0.38, metalness: 0.0 });
    floorMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = `uniform float uTime;\nvarying vec3 vFloorPos;\n${NOISE_GLSL}\n` + shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
           float r = length(position.xz);
           // folds of the mucosa outside the observed compartment, gentle swell inside
           float fold = pw_fbm(vec3(position.xz * 0.018, 1.7)) * 9.0 * smoothstep(55.0, 140.0, r);
           float swell = (pw_noise(vec3(position.xz * 0.05, uTime * 0.02)) - 0.5) * 0.5;
           transformed.y += fold + swell - 0.02;
           vFloorPos = transformed;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(normal);
           {
             float e = 0.6;
             vec2 p = position.xz;
             float rr = length(p);
             float m = smoothstep(55.0, 140.0, rr);
             float hx = pw_fbm(vec3((p + vec2(e, 0.0)) * 0.018, 1.7)) * 9.0 * m - pw_fbm(vec3((p - vec2(e, 0.0)) * 0.018, 1.7)) * 9.0 * m;
             float hz = pw_fbm(vec3((p + vec2(0.0, e)) * 0.018, 1.7)) * 9.0 * m - pw_fbm(vec3((p - vec2(0.0, e)) * 0.018, 1.7)) * 9.0 * m;
             objectNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
           }`,
        );
      shader.fragmentShader = `uniform float uTime;\nvarying vec3 vFloorPos;\n${NOISE_GLSL}\n` + shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             // epithelial cells seen through the mucus: Voronoi cells with glowing borders
             vec2 q = vFloorPos.xz / 7.5;
             vec2 w = pw_worley2(q + pw_fbm(vec3(q * 0.7, 3.0)) * 0.35);
             float border = 1.0 - smoothstep(0.02, 0.12, w.y - w.x);
             float body = smoothstep(0.0, 0.7, w.x);
             float mucus = pw_fbm(vec3(vFloorPos.xz * 0.22, uTime * 0.03));
             vec3 tissue = mix(vec3(0.13, 0.035, 0.055), vec3(0.24, 0.07, 0.09), mucus);
             tissue *= 0.7 + 0.3 * (1.0 - body);
             // the mucus layer veils the epithelium: borders read faintly
             tissue = mix(tissue, vec3(0.55, 0.22, 0.26), border * 0.18);
             float nuc = 1.0 - smoothstep(0.08, 0.16, w.x);
             tissue = mix(tissue, vec3(0.14, 0.06, 0.18), nuc * 0.45);
             // glossy mucus streaks
             float streak = pw_fbm(vec3(vFloorPos.x * 0.05, vFloorPos.z * 0.2, 2.0));
             tissue += vec3(0.04, 0.05, 0.06) * smoothstep(0.55, 0.8, streak);
             diffuseColor.rgb = tissue;
           }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           {
             vec2 q = vFloorPos.xz / 7.5;
             vec2 w = pw_worley2(q + pw_fbm(vec3(q * 0.7, 3.0)) * 0.35);
             float border = 1.0 - smoothstep(0.02, 0.09, w.y - w.x);
             float pulse = 0.6 + 0.4 * sin(uTime * 0.6 + pw_hash13(vec3(floor(q), 1.0)) * 6.28);
             totalEmissiveRadiance += vec3(0.5, 0.1, 0.18) * border * 0.08 * pulse;
           }`,
        );
    };
    floorMat.customProgramCacheKey = () => 'pw-floor-v1';
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = shadows;
    floor.name = 'floor';
    this.group.add(floor);

    // -------------------------------------------------------------- backdrop
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vDir;
          ${NOISE_GLSL}
          void main() {
            float h = vDir.y;
            vec3 deep = vec3(0.012, 0.05, 0.07);
            vec3 lumen = vec3(0.05, 0.22, 0.27);
            vec3 tissue = vec3(0.10, 0.025, 0.04);
            vec3 col = mix(deep, lumen, smoothstep(0.0, 0.9, h));
            col = mix(tissue, col, smoothstep(-0.25, 0.05, h));
            // soft light shafts from the lumen above
            float rays = pw_fbm(vec3(vDir.xz * 4.0 / max(0.25, h + 0.4), uTime * 0.03));
            col += vec3(0.08, 0.2, 0.22) * pow(rays, 3.0) * smoothstep(0.05, 0.8, h) * 0.9;
            // faint drifting caustics
            float c = pw_noise(vec3(vDir * 18.0) + uTime * 0.05);
            col += vec3(0.03, 0.08, 0.09) * smoothstep(0.62, 0.8, c) * smoothstep(0.1, 0.6, h);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.group.add(sky);

    // ----------------------------------------------- suspended particulates
    const n = quality === 'high' ? 2600 : quality === 'medium' ? 1600 : 700;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 260;
      pos[i * 3 + 1] = rnd() * 70;
      pos[i * 3 + 2] = (rnd() - 0.5) * 260;
      seed[i] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uniforms.uTime, uPixelScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixelScale;
        varying float vA;
        varying float vBlur;
        void main() {
          vec3 p = position;
          float t = uTime * (0.15 + aSeed * 0.2);
          p += vec3(sin(t + aSeed * 30.0) * 3.0, sin(t * 0.7 + aSeed * 11.0) * 1.5, cos(t * 0.8 + aSeed * 17.0) * 3.0);
          p.x = mod(p.x + uTime * 0.25 + 130.0, 260.0) - 130.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float size = (0.08 + aSeed * 0.22);
          // out-of-focus motes near the lens become large soft discs
          vBlur = smoothstep(14.0, 2.0, d);
          gl_PointSize = clamp(size * uPixelScale / max(d, 0.1) * (1.0 + vBlur * 6.0), 1.0, 120.0);
          vA = (0.25 + 0.35 * aSeed) * smoothstep(0.4, 3.0, d) * (1.0 - vBlur * 0.75) * smoothstep(240.0, 60.0, d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vBlur;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = dot(c, c);
          if (r > 1.0) discard;
          float sharp = exp(-r * 6.0);
          float disc = smoothstep(1.0, 0.75, r) * 0.35 + smoothstep(1.0, 0.92, r) * 0.25;
          float a = mix(sharp, disc, vBlur) * vA;
          gl_FragColor = vec4(vec3(0.72, 0.9, 0.95) * a, a);
        }`,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.group.add(this.motes);

    // ------------------------------------- observed compartment (ROI brackets)
    this.roi = roiBrackets(sizeX, sizeZ);
    this.group.add(this.roi);
  }

  update(time: number, pixelScale: number, cameraDistance: number): void {
    this.uniforms.uTime.value = time;
    this.moteMat.uniforms.uPixelScale.value = pixelScale;
    const m = this.roi.material as THREE.LineBasicMaterial;
    m.opacity = THREE.MathUtils.clamp((cameraDistance - 40) / 60, 0, 0.3);
    this.roi.visible = m.opacity > 0.01;
  }
}

function roiBrackets(sx: number, sz: number): THREE.LineSegments {
  const hx = sx / 2;
  const hz = sz / 2;
  const L = 6;
  const pts: number[] = [];
  for (const x of [-hx, hx]) {
    for (const y of [0]) {
      for (const z of [-hz, hz]) {
        const dx = x > 0 ? -L : L;
        const dy = y > 0 ? -L : L;
        const dz = z > 0 ? -L : L;
        pts.push(x, y, z, x + dx, y, z, x, y, z, x, y + dy, z, x, y, z, x, y, z + dz);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.3, depthWrite: false }));
}
