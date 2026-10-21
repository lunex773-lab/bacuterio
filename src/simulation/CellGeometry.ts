import { Bacterium } from './bacteria/Bacterium';

/**
 * Capsule geometry helpers shared by the simulation and the renderer.
 * Pure math, no engine types (Unity port: static class with out parameters).
 */

/** Scratch output for closest-point queries: [t, dist2, nx, ny, nz]. */
export const scratch = [0, 0, 0, 0, 0];

/**
 * Closest point from P to the cell's axis segment.
 * Writes t (signed position along axis, clamped) and squared distance.
 */
export function pointToCell(c: Bacterium, px: number, py: number, pz: number, out: number[] = scratch): number[] {
  const dx = px - c.x;
  const dy = py - c.y;
  const dz = pz - c.z;
  let t = dx * c.ax + dy * c.ay + dz * c.az;
  if (t > c.halfLength) t = c.halfLength;
  else if (t < -c.halfLength) t = -c.halfLength;
  const qx = dx - c.ax * t;
  const qy = dy - c.ay * t;
  const qz = dz - c.az * t;
  out[0] = t;
  out[1] = qx * qx + qy * qy + qz * qz;
  out[2] = qx;
  out[3] = qy;
  out[4] = qz;
  return out;
}

/** Orthonormal frame perpendicular to the axis: e1 = out[0..2], e2 = out[3..5]. */
export function perpendicularFrame(ax: number, ay: number, az: number, out: number[]): number[] {
  // pick the world axis least aligned with the cell axis
  let rx = 0;
  let ry = 1;
  let rz = 0;
  if (Math.abs(ay) > 0.9) {
    rx = 1;
    ry = 0;
  }
  // e1 = normalize(r - a (a·r))
  const d = ax * rx + ay * ry + az * rz;
  let e1x = rx - ax * d;
  let e1y = ry - ay * d;
  let e1z = rz - az * d;
  const l = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= l;
  e1y /= l;
  e1z /= l;
  out[0] = e1x;
  out[1] = e1y;
  out[2] = e1z;
  out[3] = ay * e1z - az * e1y;
  out[4] = az * e1x - ax * e1z;
  out[5] = ax * e1y - ay * e1x;
  return out;
}

const frame = [0, 0, 0, 0, 0, 0];

/** World-space surface point and outward normal of an attach coordinate. out: [x,y,z,nx,ny,nz]. */
export function attachPoint(c: Bacterium, u: number, theta: number, out: number[]): number[] {
  perpendicularFrame(c.ax, c.ay, c.az, frame);
  const s = u * c.halfLength;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const nx = frame[0] * ct + frame[3] * st;
  const ny = frame[1] * ct + frame[4] * st;
  const nz = frame[2] * ct + frame[5] * st;
  out[0] = c.x + c.ax * s + nx * c.radius;
  out[1] = c.y + c.ay * s + ny * c.radius;
  out[2] = c.z + c.az * s + nz * c.radius;
  out[3] = nx;
  out[4] = ny;
  out[5] = nz;
  return out;
}

/** Inverse of attachPoint for a point near the surface: returns [u, theta]. */
export function attachCoords(c: Bacterium, px: number, py: number, pz: number, out: number[]): number[] {
  pointToCell(c, px, py, pz, scratch);
  const t = scratch[0];
  perpendicularFrame(c.ax, c.ay, c.az, frame);
  const qx = scratch[2];
  const qy = scratch[3];
  const qz = scratch[4];
  out[0] = c.halfLength > 1e-6 ? t / c.halfLength : 0;
  out[1] = Math.atan2(qx * frame[3] + qy * frame[4] + qz * frame[5], qx * frame[0] + qy * frame[1] + qz * frame[2]);
  return out;
}

/** Volume of the capsule (µm³). */
export function capsuleVolume(halfLength: number, radius: number): number {
  return Math.PI * radius * radius * (2 * halfLength) + (4 / 3) * Math.PI * radius * radius * radius;
}

/**
 * Closest points between two segments; returns squared distance and writes
 * the parameters (s on A, t on B) into out[0], out[1].
 */
export function segmentSegment(
  ax0: number, ay0: number, az0: number, adx: number, ady: number, adz: number, ah: number,
  bx0: number, by0: number, bz0: number, bdx: number, bdy: number, bdz: number, bh: number,
  out: number[],
): number {
  // segments: A(s) = a0 + ad*s, s∈[-ah, ah]; B(t) = b0 + bd*t, t∈[-bh, bh]; ad, bd unit
  const rx = ax0 - bx0;
  const ry = ay0 - by0;
  const rz = az0 - bz0;
  const b = adx * bdx + ady * bdy + adz * bdz;
  const c = adx * rx + ady * ry + adz * rz;
  const f = bdx * rx + bdy * ry + bdz * rz;
  const denom = 1 - b * b;
  let s = denom > 1e-6 ? (b * f - c) / denom : 0;
  s = clamp(s, -ah, ah);
  let t = b * s + f;
  if (t < -bh) {
    t = -bh;
    s = clamp(b * t - c, -ah, ah);
  } else if (t > bh) {
    t = bh;
    s = clamp(b * t - c, -ah, ah);
  }
  out[0] = s;
  out[1] = t;
  const dx = rx + adx * s - bdx * t;
  const dy = ry + ady * s - bdy * t;
  const dz = rz + adz * s - bdz * t;
  return dx * dx + dy * dy + dz * dz;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
