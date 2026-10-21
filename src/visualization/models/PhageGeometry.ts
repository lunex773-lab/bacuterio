import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural phage models at true scale (1 unit = 1 µm).
 * Local frame: the baseplate tip sits at the origin, the head points to +Y,
 * so an adsorbed phage is placed at the attach point with +Y along the surface normal.
 *
 * Dimensions follow published morphology in round numbers
 * (T4: head ~86×111 nm, tail ~100 nm, long tail fibres ~145 nm; T7: head ~60 nm, tail ~23 nm).
 */
export interface PhageDims {
  headRadius: number;
  headElongation: number;
  headCenter: number;
  tailLength: number;
  tailRadius: number;
  baseplateRadius: number;
  fiberProximal: number;
  fiberDistal: number;
  fiberRadius: number;
  collar: boolean;
}

export const T4_DIMS: PhageDims = {
  headRadius: 0.043,
  headElongation: 1.3,
  headCenter: 0.19,
  tailLength: 0.1,
  tailRadius: 0.0115,
  baseplateRadius: 0.026,
  fiberProximal: 0.072,
  fiberDistal: 0.074,
  fiberRadius: 0.0022,
  collar: true,
};

export const T7_DIMS: PhageDims = {
  headRadius: 0.031,
  headElongation: 1.0,
  headCenter: 0.056,
  tailLength: 0.022,
  tailRadius: 0.009,
  baseplateRadius: 0.013,
  fiberProximal: 0.018,
  fiberDistal: 0.016,
  fiberRadius: 0.0018,
  collar: false,
};

export function dimsFor(morphology: string): PhageDims {
  return morphology === 'podovirus' ? T7_DIMS : T4_DIMS;
}

/** Icosahedron with a 5-fold axis along Y, optionally elongated (prolate head). */
export function capsidGeometry(radius: number, elongation: number, detail = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  // default icosahedron has a vertex at (0, 1, φ)/|…|; rotate it onto +Y
  const phi = (1 + Math.sqrt(5)) / 2;
  const v = new THREE.Vector3(0, 1, phi).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 1, 0));
  g.applyQuaternion(q);
  g.scale(1, elongation, 1);
  return g.toNonIndexed();
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Fibre polyline for fibre i of 6 with a given spread (0 folded … 1 splayed onto a surface). */
export function fiberPoints(d: PhageDims, i: number, spread: number, out: THREE.Vector3[]): THREE.Vector3[] {
  const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const root = new THREE.Vector3(ca * d.baseplateRadius * 0.9, 0.006, sa * d.baseplateRadius * 0.9);
  // proximal half: from folded-up along the sheath to splayed outward
  const upAngle = THREE.MathUtils.lerp(0.18, 1.25, spread);
  const knee = root.clone().add(new THREE.Vector3(ca * Math.sin(upAngle), Math.cos(upAngle), sa * Math.sin(upAngle)).multiplyScalar(d.fiberProximal));
  // distal half: hangs back down toward the surface
  const downAngle = THREE.MathUtils.lerp(2.75, 2.2, spread);
  const tip = knee.clone().add(new THREE.Vector3(ca * Math.sin(downAngle), Math.cos(downAngle), sa * Math.sin(downAngle)).multiplyScalar(d.fiberDistal));
  if (spread > 0.7) tip.y = Math.max(tip.y, -0.002);
  out[0] = root;
  out[1] = knee;
  out[2] = tip;
  return out;
}

export interface PhagePartGeometries {
  head: THREE.BufferGeometry;
  body: THREE.BufferGeometry;
  fibers: THREE.BufferGeometry;
}

/**
 * Parts with vertex colours baked in so a single instanced draw shows head / sheath / fibres.
 * `contracted` gives the post-injection pose (short sheath, exposed tube).
 */
export function buildPhageParts(d: PhageDims, spread = 0.55, contracted = false, segments = 6): PhagePartGeometries {
  const head = capsidGeometry(d.headRadius, d.headElongation);
  head.translate(0, d.headCenter, 0);

  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(d.baseplateRadius, d.baseplateRadius * 0.8, 0.008, 6);
  base.translate(0, 0.004, 0);
  parts.push(base);
  const headBottom = d.headCenter - d.headRadius * d.headElongation * 0.82;
  if (d.tailLength > 0.05) {
    // myovirus: inner tube + contractile sheath with rings
    const tubeTop = headBottom;
    const tube = new THREE.CylinderGeometry(d.tailRadius * 0.45, d.tailRadius * 0.45, tubeTop - 0.008, segments);
    tube.translate(0, 0.008 + (tubeTop - 0.008) / 2, 0);
    parts.push(tube);
    const sheathLen = contracted ? (tubeTop - 0.008) * 0.45 : tubeTop - 0.016;
    const sheathR = contracted ? d.tailRadius * 1.55 : d.tailRadius;
    const sheathBottom = contracted ? tubeTop - sheathLen : 0.012;
    const rings = contracted ? 6 : 12;
    for (let k = 0; k < rings; k++) {
      const h = sheathLen / rings;
      const ring = new THREE.CylinderGeometry(sheathR, sheathR * 0.92, h * 0.82, segments + 2);
      ring.translate(0, sheathBottom + h * (k + 0.5), 0);
      parts.push(ring);
    }
    if (d.collar) {
      const collar = new THREE.CylinderGeometry(d.tailRadius * 1.6, d.tailRadius * 1.2, 0.006, 8);
      collar.translate(0, tubeTop - 0.002, 0);
      parts.push(collar);
    }
  } else {
    // podovirus: short conical tail
    const cone = new THREE.CylinderGeometry(d.tailRadius * 0.6, d.tailRadius * 1.25, headBottom - 0.006, segments);
    cone.translate(0, 0.006 + (headBottom - 0.006) / 2, 0);
    parts.push(cone);
  }
  const body = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;

  const fiberParts: THREE.BufferGeometry[] = [];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    fiberPoints(d, i, spread, pts);
    fiberParts.push(cylinderBetween(pts[0], pts[1], d.fiberRadius, 4).toNonIndexed());
    fiberParts.push(cylinderBetween(pts[1], pts[2], d.fiberRadius * 0.85, 4).toNonIndexed());
    const knee = new THREE.SphereGeometry(d.fiberRadius * 1.4, 4, 3);
    knee.translate(pts[1].x, pts[1].y, pts[1].z);
    fiberParts.push(knee.toNonIndexed());
  }
  const fibers = mergeGeometries(fiberParts)!;
  return { head, body, fibers };
}

function paint(g: THREE.BufferGeometry, color: THREE.Color, jitter: number, seed: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  let s = seed;
  for (let i = 0; i < n; i += 3) {
    // per-face variation reads as protein subunits
    s = (s * 16807) % 2147483647;
    const v = 1 + ((s / 2147483647) - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      c[(i + k) * 3] = color.r * v;
      c[(i + k) * 3 + 1] = color.g * v;
      c[(i + k) * 3 + 2] = color.b * v;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export const PHAGE_COLORS = {
  head: new THREE.Color('#cfe6f2'),
  body: new THREE.Color('#8fb2c4'),
  fibers: new THREE.Color('#b9d3de'),
};

/** Single merged, vertex-coloured geometry for instancing. */
export function buildInstancedPhageGeometry(d: PhageDims, spread = 0.55, contracted = false, lowDetail = false): THREE.BufferGeometry {
  const p = buildPhageParts(d, spread, contracted, lowDetail ? 5 : 7);
  const geos = [paint(p.head, PHAGE_COLORS.head, 0.22, 7), paint(p.body, PHAGE_COLORS.body, 0.12, 11)];
  if (!lowDetail) geos.push(paint(p.fibers, PHAGE_COLORS.fibers, 0.05, 13));
  const merged = mergeGeometries(geos)!;
  merged.computeVertexNormals();
  return merged;
}
