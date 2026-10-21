import * as THREE from 'three';
import { NOISE_GLSL } from './ShaderChunks';

/**
 * Render states (sim state + species collapsed into one visual identity).
 * Order matters: it indexes uStateColors.
 */
export enum CellLook {
  Susceptible = 0,
  Infected = 1,
  Resistant = 2,
  Dead = 3,
  Dormant = 4,
  NonHost = 5,
}

/** Same hues as the charts so identity is consistent between 3D and UI (validated dark palette). */
export const CELL_COLORS: Record<CellLook, string> = {
  [CellLook.Susceptible]: '#3987e5',
  [CellLook.Infected]: '#d95926',
  [CellLook.Resistant]: '#199e70',
  [CellLook.Dead]: '#40464c',
  [CellLook.Dormant]: '#c98500',
  [CellLook.NonHost]: '#d55181',
};

export interface CellUniforms {
  uTime: { value: number };
  uStateColors: { value: THREE.Color[] };
  uAccent: { value: THREE.Color };
}

export function createCellUniforms(): CellUniforms {
  return {
    uTime: { value: 0 },
    uStateColors: { value: [0, 1, 2, 3, 4, 5].map((i) => new THREE.Color(CELL_COLORS[i as CellLook])) },
    uAccent: { value: new THREE.Color('#ffe9a8') },
  };
}

const VERTEX_PREFIX = /* glsl */ `
attribute vec4 aShape; // x: half length / radius, y: look, z: infection progress, w: seed
attribute vec4 aInfo;  // x: stage, y: activity, z: death fade, w: flags (1 highlight, 2 hidden)
uniform float uTime;
varying vec4 vShape;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vPWWorld;
${NOISE_GLSL}
`;

const STRETCH = /* glsl */ `
  vec3 transformed = vec3(position);
  float hl = aShape.x;
  float ay = abs(position.y);
  transformed.y = ay <= 1.0 ? position.y * hl : sign(position.y) * (ay - 1.0 + hl);
  float look = aShape.y;
  float infected = 1.0 - step(0.5, abs(look - 1.0));
  float dead = 1.0 - step(0.5, abs(look - 3.0));
  float swell = 1.0 + 0.1 * infected * smoothstep(0.7, 1.0, aShape.z)
    + infected * smoothstep(0.92, 1.0, aShape.z) * 0.035 * sin(uTime * 16.0 + aShape.w * 40.0);
  transformed.xz *= swell;
  transformed *= 1.0 - dead * aInfo.z * 0.3;
  if (aInfo.w > 1.5) transformed *= 0.0;
`;

const VERTEX_BEGIN = /* glsl */ `
${STRETCH}
  // slow membrane undulation (presentational)
  float live = 1.0 - dead;
  float wob = (pw_noise(position * 2.2 + aShape.w * 17.0 + uTime * 0.3) - 0.5) * 0.05 * live * (0.4 + 0.6 * aInfo.y);
  transformed += normal * wob;
  vLocal = vec3(position.x, transformed.y, position.z);
  vShape = aShape;
  vInfo = aInfo;
`;

const FRAGMENT_PREFIX = /* glsl */ `
uniform float uTime;
uniform vec3 uStateColors[6];
uniform vec3 uAccent;
varying vec4 vShape;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vPWWorld;
${NOISE_GLSL}
`;

const FRAGMENT_COLOR = /* glsl */ `
  int look = int(vShape.y + 0.5);
  float seed = vShape.w;
  float progress = vShape.z;
  float stage = vInfo.x;
  if (look == 3) {
    float d = pw_noise(vLocal * 3.5 + seed * 11.0);
    if (d < vInfo.z * 1.1 - 0.05) discard;
  }
  vec3 base = uStateColors[look];
  float grain = pw_fbm(vLocal * 2.6 + seed * 13.0);
  vec3 col = base * (0.62 + 0.55 * grain);
  if (look == 2) {
    // resistant: banded surface (shape cue in addition to colour)
    float band = smoothstep(0.18, 0.32, abs(fract(vLocal.y * 1.25 + seed) - 0.5));
    col *= 0.62 + 0.5 * band;
  }
  if (look == 4) {
    float g = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(g), 0.45) * 0.7;
  }
  if (look == 3) col *= 0.55;
  if (!gl_FrontFacing) {
    // cutaway: cytoplasm cross-section
    col = mix(base * 0.18, vec3(0.05, 0.07, 0.08), 0.5);
  }
  diffuseColor.rgb = col;
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
  {
    vec3 Vw = normalize(cameraPosition - vPWWorld);
    float facing = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
    float rim = pow(1.0 - facing, 2.6);
    int lk = int(vShape.y + 0.5);
    vec3 base = uStateColors[lk];
    float alive = lk == 3 ? 0.0 : 1.0;
    float activity = vInfo.y;
    // parallax sample "inside" the cell gives a sense of depth through the membrane
    vec3 pin = vPWWorld * 2.2 - Vw * 0.9 + vShape.w * 7.0;
    float inner = pw_fbm(pin * 1.4 + vec3(0.0, uTime * 0.05, 0.0));
    float core = smoothstep(0.25, 1.0, facing);
    float axial = 1.0 - smoothstep(vShape.x * 0.75 + 0.2, vShape.x + 0.9, abs(vLocal.y));
    // host nucleoid, degraded after phage takeover
    float host = 1.0;
    if (lk == 1) host = 1.0 - smoothstep(2.6, 4.0, vInfo.x);
    float nucleoid = smoothstep(0.48, 0.75, inner) * core * axial * host * alive;
    vec3 glow = base * nucleoid * (0.25 + 0.5 * activity);
    // membrane rim light
    glow += mix(base, vec3(0.85, 0.95, 1.0), 0.45) * rim * 0.55 * alive;
    if (lk == 1) {
      float stg = vInfo.x;
      // replicating phage DNA: teal filaments
      float rep = smoothstep(3.5, 4.4, stg);
      float fil = 1.0 - abs(pw_noise(pin * 3.1 + uTime * 0.12) * 2.0 - 1.0);
      glow += vec3(0.25, 1.0, 0.85) * pow(fil, 10.0) * rep * core * core * axial * 0.55;
      // assembled capsids: bright speckles whose density follows maturation
      float mature = clamp((progress - 0.48) / 0.52, 0.0, 1.0) * step(4.5, stg);
      vec2 w = pw_worley(pin * 3.2);
      float dotMask = 1.0 - smoothstep(0.03, 0.1, w.x);
      float keep = step(pw_hash13(floor(pin * 3.2) + 3.1), mature);
      glow += vec3(0.75, 0.92, 1.0) * dotMask * keep * core * axial * 1.3;
      // the swollen membrane flickers just before lysis
      float pre = smoothstep(0.9, 1.0, progress);
      glow += vec3(1.0, 0.55, 0.3) * rim * pre * (0.6 + 0.4 * sin(uTime * 22.0 + vShape.w * 30.0));
    }
    if (lk == 3) {
      // dissolving debris edge
      float d = pw_noise(vLocal * 3.5 + vShape.w * 11.0);
      float edge = 1.0 - smoothstep(0.0, 0.08, d - (vInfo.z * 1.1 - 0.05));
      glow += vec3(1.0, 0.6, 0.35) * edge * 1.5 * (1.0 - vInfo.z);
    }
    if (vInfo.w > 0.5 && vInfo.w < 1.5) {
      glow += uAccent * (rim * 1.4 + 0.08);
    }
    if (!gl_FrontFacing) {
      float threads = 1.0 - abs(pw_noise(vLocal * 5.0 + vShape.w * 9.0) * 2.0 - 1.0);
      glow = base * pow(threads, 8.0) * 0.9 * host * alive;
    }
    totalEmissiveRadiance += glow;
  }
`;

/** Instanced capsule material: lit, shadowed, with procedural interior hints. */
export function createCellMaterial(uniforms: CellUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uStateColors = uniforms.uStateColors;
    shader.uniforms.uAccent = uniforms.uAccent;
    shader.vertexShader = VERTEX_PREFIX + shader.vertexShader
      .replace('#include <begin_vertex>', VERTEX_BEGIN)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 pw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            pw = instanceMatrix * pw;
          #endif
          vPWWorld = (modelMatrix * pw).xyz;
        }`,
      );
    shader.fragmentShader = FRAGMENT_PREFIX + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAGMENT_COLOR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAGMENT_EMISSIVE);
  };
  m.customProgramCacheKey = () => 'pw-cell-v1';
  return m;
}

/** Shadow-pass material applying the same capsule stretch. */
export function createCellDepthMaterial(uniforms: CellUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader =
      `attribute vec4 aShape;\nattribute vec4 aInfo;\nuniform float uTime;\n` +
      shader.vertexShader.replace('#include <begin_vertex>', STRETCH);
  };
  m.customProgramCacheKey = () => 'pw-cell-depth-v1';
  return m;
}

/** Unit capsule: radius 1, cylinder half length 1 (stretched per instance in the shader). */
export function createCapsuleGeometry(capSegments = 8, radialSegments = 20): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(1, 2, capSegments, radialSegments);
}
