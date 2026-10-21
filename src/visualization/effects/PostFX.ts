import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Final grade: vignette, gentle chromatic fringe at the edges, film grain (microscope optics). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.022 },
    uVignette: { value: 0.38 },
    uAberration: { value: 0.0018 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * (0.5 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // cool shadows, slightly warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += vec3(-0.004, 0.006, 0.012) * (1.0 - smoothstep(0.0, 0.25, l));
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
      float g = rand(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - l));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass | null;
  readonly bokeh: BokehPass | null;
  private readonly grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: 'high' | 'medium' | 'low') {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality === 'high' ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.78);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    if (quality === 'high') {
      this.bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.00012, maxblur: 0.004 });
      this.composer.addPass(this.bokeh);
    } else this.bokeh = null;
    this.grade = new ShaderPass(GradeShader);
    if (quality === 'low') {
      this.grade.uniforms.uAberration.value = 0;
      this.grade.uniforms.uGrain.value = 0.02;
    }
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(time: number, focusDistance: number): void {
    this.grade.uniforms.uTime.value = time;
    if (this.bokeh) {
      const u = (this.bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
      u.focus.value = focusDistance;
      // depth of field stays subtle and scales with the viewing distance (design §5.3)
      u.aperture.value = 0.0009 / Math.max(1, focusDistance);
    }
    this.composer.render();
  }
}
