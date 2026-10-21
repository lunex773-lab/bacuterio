import * as THREE from 'three';

const SPARKS_PER_BURST = 90;
const SHARDS_PER_BURST = 26;
const MAX_BURSTS = 24;

interface Burst {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  scale: number;
}

/**
 * Event-driven presentation of lysis (design §3.3): the simulation has already
 * released the progeny; this only plays the rupture. Heavy effects never affect results.
 */
export class LysisEffects {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly sparkPos: Float32Array;
  private readonly sparkVel: Float32Array;
  private readonly sparkLife: Float32Array;
  private readonly sparks: THREE.Points;
  private readonly sparkMat: THREE.ShaderMaterial;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardState: Float32Array; // pos3 vel3 rot3 spin3
  private readonly flashes: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly ringState: Float32Array; // x y z age life size kind
  private readonly ringCap = 64;
  private next = 0;
  private nextRing = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    const nSpark = MAX_BURSTS * SPARKS_PER_BURST;
    this.sparkPos = new Float32Array(nSpark * 3);
    this.sparkVel = new Float32Array(nSpark * 3);
    this.sparkLife = new Float32Array(nSpark);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.sparkLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aLife;
        uniform float uPixelScale;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife <= 0.0 ? 0.0 : clamp(0.12 * uPixelScale / max(-mv.z, 0.05), 1.0, 22.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = dot(c, c);
          if (r > 1.0 || vLife <= 0.0) discard;
          float a = exp(-r * 5.0) * vLife;
          vec3 hot = vec3(1.0, 0.72, 0.4);
          vec3 cool = vec3(0.5, 1.0, 0.9);
          gl_FragColor = vec4(mix(cool, hot, vLife) * a * 1.6, a);
        }`,
    });
    this.sparks = new THREE.Points(g, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);

    // curved membrane fragments
    const shardGeo = new THREE.SphereGeometry(0.42, 5, 3, 0, Math.PI * 0.55, 0, Math.PI * 0.4);
    const shardMat = new THREE.MeshStandardMaterial({
      color: '#d95926',
      emissive: '#ff7a3a',
      emissiveIntensity: 0.5,
      roughness: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.shards = new THREE.InstancedMesh(shardGeo, shardMat, MAX_BURSTS * SHARDS_PER_BURST);
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardState = new Float32Array(MAX_BURSTS * SHARDS_PER_BURST * 12);
    this.group.add(this.shards);

    const flashMat = new THREE.MeshBasicMaterial({
      color: '#ffd2a0',
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), flashMat, MAX_BURSTS);
    this.flashes.frustumCulled = false;
    this.flashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BURSTS * 3), 3);
    this.group.add(this.flashes);

    const ringMat = new THREE.MeshBasicMaterial({
      color: '#9ff7e6',
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.02, 4, 40), ringMat, this.ringCap);
    this.rings.frustumCulled = false;
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.ringCap * 3), 3);
    this.ringState = new Float32Array(this.ringCap * 7);
    this.group.add(this.rings);

    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push({ active: false, age: 0, life: 1, x: 0, y: 0, z: 0, scale: 1 });
  }

  /** Start a rupture at a cell position. */
  spawnLysis(x: number, y: number, z: number, burstSize: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_BURSTS;
    const b = this.bursts[i];
    b.active = true;
    b.age = 0;
    b.life = 2.2;
    b.x = x;
    b.y = y;
    b.z = z;
    b.scale = 0.8 + Math.min(1, burstSize / 150) * 0.6;
    for (let k = 0; k < SPARKS_PER_BURST; k++) {
      const j = i * SPARKS_PER_BURST + k;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 1.2 + Math.random() * 3.2;
      this.sparkPos[j * 3] = x;
      this.sparkPos[j * 3 + 1] = y;
      this.sparkPos[j * 3 + 2] = z;
      this.sparkVel[j * 3] = r * Math.cos(a) * sp;
      this.sparkVel[j * 3 + 1] = u * sp * 0.8 + 0.4;
      this.sparkVel[j * 3 + 2] = r * Math.sin(a) * sp;
      this.sparkLife[j] = 0.6 + Math.random() * 0.4;
    }
    for (let k = 0; k < SHARDS_PER_BURST; k++) {
      const o = (i * SHARDS_PER_BURST + k) * 12;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 0.6 + Math.random() * 1.6;
      const st = this.shardState;
      st[o] = x + r * Math.cos(a) * 0.3;
      st[o + 1] = y + u * 0.3;
      st[o + 2] = z + r * Math.sin(a) * 0.3;
      st[o + 3] = r * Math.cos(a) * sp;
      st[o + 4] = u * sp * 0.6 + 0.2;
      st[o + 5] = r * Math.sin(a) * sp;
      st[o + 6] = Math.random() * 6;
      st[o + 7] = Math.random() * 6;
      st[o + 8] = Math.random() * 6;
      st[o + 9] = (Math.random() - 0.5) * 6;
      st[o + 10] = (Math.random() - 0.5) * 6;
      st[o + 11] = (Math.random() - 0.5) * 6;
    }
  }

  /** Small expanding ring (adsorption or injection cue). */
  spawnRing(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
    const i = this.nextRing;
    this.nextRing = (this.nextRing + 1) % this.ringCap;
    const o = i * 7;
    const r = this.ringState;
    r[o] = x;
    r[o + 1] = y;
    r[o + 2] = z;
    r[o + 3] = 0;
    r[o + 4] = 1.4;
    r[o + 5] = size;
    // encode the normal as a quaternion later; store packed direction index via atan
    this.ringNormals[i * 3] = nx;
    this.ringNormals[i * 3 + 1] = ny;
    this.ringNormals[i * 3 + 2] = nz;
  }
  private readonly ringNormals = new Float32Array(64 * 3);

  update(dt: number, pixelScale: number): void {
    this.sparkMat.uniforms.uPixelScale.value = pixelScale;
    const drag = Math.exp(-dt * 2.4);
    let anyActive = false;
    for (let i = 0; i < MAX_BURSTS; i++) {
      const b = this.bursts[i];
      if (!b.active) {
        this.m.makeScale(0, 0, 0);
        this.flashes.setMatrixAt(i, this.m);
        for (let k = 0; k < SHARDS_PER_BURST; k++) this.shards.setMatrixAt(i * SHARDS_PER_BURST + k, this.m);
        continue;
      }
      anyActive = true;
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        b.active = false;
        for (let k = 0; k < SPARKS_PER_BURST; k++) this.sparkLife[i * SPARKS_PER_BURST + k] = 0;
        continue;
      }
      // flash: quick expanding glow
      const fl = Math.max(0, 1 - b.age / 0.5);
      this.v.set(b.x, b.y, b.z);
      this.s.setScalar((0.5 + b.age * 2.6) * b.scale * (fl > 0 ? 1 : 0));
      this.m.compose(this.v, this.q.identity(), this.s);
      this.flashes.setMatrixAt(i, this.m);
      this.flashes.setColorAt(i, this.c.setScalar(fl * fl * 0.45));
      for (let k = 0; k < SPARKS_PER_BURST; k++) {
        const j = i * SPARKS_PER_BURST + k;
        this.sparkVel[j * 3] *= drag;
        this.sparkVel[j * 3 + 1] *= drag;
        this.sparkVel[j * 3 + 2] *= drag;
        this.sparkPos[j * 3] += this.sparkVel[j * 3] * dt;
        this.sparkPos[j * 3 + 1] += this.sparkVel[j * 3 + 1] * dt;
        this.sparkPos[j * 3 + 2] += this.sparkVel[j * 3 + 2] * dt;
        this.sparkLife[j] = Math.max(0, this.sparkLife[j] - dt / b.life);
      }
      for (let k = 0; k < SHARDS_PER_BURST; k++) {
        const o = (i * SHARDS_PER_BURST + k) * 12;
        const st = this.shardState;
        st[o + 3] *= drag;
        st[o + 4] = st[o + 4] * drag - dt * 0.15;
        st[o + 5] *= drag;
        st[o] += st[o + 3] * dt;
        st[o + 1] = Math.max(0.05, st[o + 1] + st[o + 4] * dt);
        st[o + 2] += st[o + 5] * dt;
        st[o + 6] += st[o + 9] * dt;
        st[o + 7] += st[o + 10] * dt;
        st[o + 8] += st[o + 11] * dt;
        this.e.set(st[o + 6], st[o + 7], st[o + 8]);
        this.q.setFromEuler(this.e);
        this.v.set(st[o], st[o + 1], st[o + 2]);
        this.s.setScalar((1 - t) * (1 - t) * b.scale);
        this.m.compose(this.v, this.q, this.s);
        this.shards.setMatrixAt(i * SHARDS_PER_BURST + k, this.m);
      }
    }
    this.flashes.instanceMatrix.needsUpdate = true;
    this.flashes.instanceColor!.needsUpdate = true;
    this.shards.instanceMatrix.needsUpdate = true;
    this.sparks.geometry.getAttribute('position').needsUpdate = true;
    this.sparks.geometry.getAttribute('aLife').needsUpdate = true;
    this.sparks.visible = anyActive;

    const r = this.ringState;
    for (let i = 0; i < this.ringCap; i++) {
      const o = i * 7;
      if (r[o + 4] <= 0 || r[o + 3] >= r[o + 4]) {
        this.m.makeScale(0, 0, 0);
        this.rings.setMatrixAt(i, this.m);
        continue;
      }
      r[o + 3] += dt;
      const t = r[o + 3] / r[o + 4];
      this.v.set(this.ringNormals[i * 3], this.ringNormals[i * 3 + 1], this.ringNormals[i * 3 + 2]);
      this.q.setFromUnitVectors(Z_AXIS, this.v);
      this.s.setScalar(r[o + 5] * (0.3 + t * 1.1) * (t < 1 ? 1 : 0));
      this.v.set(r[o], r[o + 1], r[o + 2]);
      this.m.compose(this.v, this.q, this.s);
      this.rings.setMatrixAt(i, this.m);
      this.rings.setColorAt(i, this.c.setScalar((1 - t) * 0.7));
    }
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor!.needsUpdate = true;
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
