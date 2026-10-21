import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraBookmark {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
}

const BOOKMARK_KEY = 'phage-inner-world/bookmarks';

/**
 * Orbit / zoom / pan with smooth focus-follow, fly-to transitions, saved viewpoints
 * and a camera-facing cutaway plane. Mouse and touch both go through OrbitControls,
 * so the camera logic is shared between PC and mobile (design §5.2).
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  /** Planes array shared with materials; empty when the cutaway is off. */
  readonly clipping: THREE.Plane[] = [];
  following = false;
  cutaway = false;
  private followTarget = new THREE.Vector3();
  private hasFollowTarget = false;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number; dur: number } | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 0.18;
    c.maxDistance = 240;
    c.zoomSpeed = 1.1;
    c.rotateSpeed = 0.6;
    c.panSpeed = 0.8;
    c.maxPolarAngle = Math.PI * 0.495;
    c.screenSpacePanning = true;
    c.zoomToCursor = false;
    c.addEventListener('start', () => {
      // a manual drag cancels a running fly-to, but keeps following
      this.fly = null;
    });
  }

  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  setFollowTarget(p: THREE.Vector3 | null): void {
    if (p) {
      this.followTarget.copy(p);
      this.hasFollowTarget = true;
    } else this.hasFollowTarget = false;
  }

  /** Smoothly move to look at `target` from `distance` (keeps the current viewing direction). */
  flyTo(target: THREE.Vector3, distance: number, duration = 1.4, direction?: THREE.Vector3): void {
    const dir = direction ? direction.clone().normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.15) {
      dir.y = 0.35;
      dir.normalize();
    }
    this.fly = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(dir, distance),
      fromT: this.controls.target.clone(),
      toT: target.clone(),
      t: 0,
      dur: duration,
    };
  }

  overview(): void {
    this.following = false;
    this.flyTo(new THREE.Vector3(0, 4, 0), 105, 1.6, new THREE.Vector3(0.75, 0.62, 0.95));
  }

  /** Place the camera immediately (no transition). */
  jumpTo(position: THREE.Vector3, target: THREE.Vector3): void {
    this.fly = null;
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.clipping.length = 0;
    if (on) this.clipping.push(this.cutPlane);
  }

  update(dt: number): void {
    const c = this.controls;
    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const k = easeInOut(Math.min(1, f.t));
      // when following, the destination tracks the moving target
      if (this.following && this.hasFollowTarget) {
        this.tmp.copy(this.followTarget).sub(f.toT);
        f.toT.add(this.tmp);
        f.to.add(this.tmp);
      }
      this.camera.position.lerpVectors(f.from, f.to, k);
      c.target.lerpVectors(f.fromT, f.toT, k);
      if (f.t >= 1) this.fly = null;
    } else if (this.following && this.hasFollowTarget) {
      const a = 1 - Math.exp(-dt * 5);
      this.tmp.copy(this.followTarget).sub(c.target).multiplyScalar(a);
      c.target.add(this.tmp);
      this.camera.position.add(this.tmp);
    }
    c.update();

    // adapt clip planes to the viewing scale (from 0.2 µm to the whole compartment)
    const d = this.distance;
    this.camera.near = Math.max(0.004, d * 0.012);
    this.camera.far = Math.max(1500, d * 30);
    this.camera.updateProjectionMatrix();

    if (this.cutaway) {
      // plane through the focus, facing the camera: removes everything in front of it
      // three.js clips the negative side, i.e. points nearer to the camera than the target
      this.camera.getWorldDirection(this.tmp2);
      this.cutPlane.normal.copy(this.tmp2);
      this.cutPlane.constant = -this.tmp2.dot(c.target);
    }
  }

  // ---------------------------------------------------------------- bookmarks

  loadBookmarks(): CameraBookmark[] {
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      return raw ? (JSON.parse(raw) as CameraBookmark[]) : [];
    } catch {
      return [];
    }
  }

  saveBookmark(name: string): CameraBookmark[] {
    const list = this.loadBookmarks();
    list.push({
      name,
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    });
    while (list.length > 6) list.shift();
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable: bookmarks last for this session only */
    }
    return list;
  }

  applyBookmark(b: CameraBookmark): void {
    this.following = false;
    const target = new THREE.Vector3().fromArray(b.target);
    const pos = new THREE.Vector3().fromArray(b.position);
    this.fly = { from: this.camera.position.clone(), to: pos, fromT: this.controls.target.clone(), toT: target, t: 0, dur: 1.4 };
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
