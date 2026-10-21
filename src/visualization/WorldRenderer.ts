import * as THREE from 'three';
import { SimEvent, SimEventType } from '../core/EventQueue';
import { getPhageSpec } from '../core/SimulationConfig';
import { SimulationWorld } from '../core/SimulationWorld';
import { BacteriaState, Bacterium, InfectionStage } from '../simulation/bacteria/Bacterium';
import { attachPoint } from '../simulation/CellGeometry';
import { PhageState } from '../simulation/phage/PhageAgent';
import { CameraController } from './camera/CameraController';
import { LysisEffects } from './effects/LysisEffects';
import { PostFX } from './effects/PostFX';
import { EnvironmentView, FOG_COLOR } from './EnvironmentView';
import { HeroCell } from './HeroCell';
import { HeroPhage } from './HeroPhage';
import { BacteriaView } from './instancing/BacteriaView';
import { PhageView } from './instancing/PhageView';
import { PopulationCloudView } from './instancing/PopulationCloudView';
import { createCellUniforms } from './materials/CellMaterial';
import { dimsFor } from './models/PhageGeometry';

export type Quality = 'high' | 'medium' | 'low';

export type Selection = { kind: 'cell'; id: number } | { kind: 'phage'; id: number } | null;

export function autoQuality(): Quality {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  if (coarse && small) return 'low';
  if (coarse) return 'medium';
  return 'high';
}

/**
 * Reads the simulation and draws it. Owns no biological state (design §2 rule):
 * everything here can be dropped or degraded without changing results.
 */
export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: CameraController;
  readonly quality: Quality;
  private post: PostFX;
  private env: EnvironmentView;
  private readonly cellUniforms = createCellUniforms();
  private bacteria!: BacteriaView;
  private phages!: PhageView;
  private cloud!: PopulationCloudView;
  private effects!: LysisEffects;
  private heroCell!: HeroCell;
  private heroPhage!: HeroPhage;
  private worldGroup = new THREE.Group();
  private world: SimulationWorld | null = null;
  private readonly tmp = [0, 0, 0, 0, 0, 0];
  private readonly v = new THREE.Vector3();
  pixelScale = 800;
  selection: Selection = null;
  /** Cell currently shown at interior scale (or -1). */
  heroCellId = -1;
  heroPhageShown = false;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 2000);
    this.camera.position.set(70, 48, 82);
    this.cam = new CameraController(this.camera, this.renderer.domElement);
    this.cam.controls.target.set(0, 3, 0);

    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0062);
    this.scene.background = FOG_COLOR;
    this.env = new EnvironmentView(80, 30, 80, quality, quality !== 'low');
    this.scene.add(this.env.group);
    this.scene.add(this.worldGroup);
    this.post = new PostFX(this.renderer, this.scene, this.camera, quality);
    this.resize(container.clientWidth, container.clientHeight);
  }

  /** (Re)build entity views for a world; called on new runs and loads. */
  setWorld(w: SimulationWorld): void {
    this.world = w;
    this.worldGroup.clear();
    const dims = dimsFor(getPhageSpec(w.config.phageId).morphology);
    const clip = this.cam.clipping;
    this.bacteria = new BacteriaView(this.cellUniforms, w.config.maxBacteria + 64, this.quality === 'low' ? 'low' : 'high', this.quality !== 'low');
    (this.bacteria.mesh.material as THREE.Material).clippingPlanes = clip;
    this.phages = new PhageView(dims, this.quality === 'low' ? 4000 : 9000);
    this.phages.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !(m instanceof THREE.ShaderMaterial)) m.clippingPlanes = clip;
    });
    this.cloud = new PopulationCloudView(this.quality === 'low' ? 2500 : 6000);
    this.effects = new LysisEffects();
    this.heroCell = new HeroCell(dims, clip);
    this.heroPhage = new HeroPhage(dims, clip);
    this.worldGroup.add(this.bacteria.mesh, this.phages.group, this.cloud.group, this.effects.group, this.heroCell.group, this.heroPhage.group);
    this.selection = null;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
    this.pixelScale = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /** World position of the current selection or the tracked phage (interpolated). */
  entityPosition(sel: Selection, out: THREE.Vector3, alpha: number): boolean {
    const w = this.world;
    if (!w || !sel) return false;
    if (sel.kind === 'cell') {
      const c = w.findCell(sel.id);
      if (!c) return false;
      out.set(c.x, c.y, c.z);
      return true;
    }
    const i = w.phageSystem.indexOf(sel.id);
    if (i >= 0) {
      const p = w.phages[i];
      out.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      return true;
    }
    // a phage that has adsorbed lives on in its host cell
    for (const c of w.bacteria) {
      if (c.state === BacteriaState.Infected && c.founderId === sel.id) {
        attachPoint(c, c.attachU, c.attachTheta, this.tmp);
        if (c.stage <= InfectionStage.Injecting) out.set(this.tmp[0], this.tmp[1], this.tmp[2]);
        else out.set(c.x, c.y, c.z);
        return true;
      }
    }
    return false;
  }

  handleEvents(events: SimEvent[]): void {
    const w = this.world;
    if (!w) return;
    const cam = this.camera.position;
    let lyses = 0;
    let rings = 0;
    const maxD = Math.max(30, this.cam.distance * 1.6);
    for (const e of events) {
      const d2 = (e.x - cam.x) ** 2 + (e.y - cam.y) ** 2 + (e.z - cam.z) ** 2;
      if (d2 > maxD * maxD) continue;
      if (e.type === SimEventType.Lysis && lyses < 5) {
        this.effects.spawnLysis(e.x, e.y, e.z, e.value);
        lyses++;
      } else if (e.type === SimEventType.Adsorption && this.cam.distance < 25 && rings++ < 6) {
        const c = w.findCell(e.entityId);
        if (!c) continue;
        attachPoint(c, c.attachU, c.attachTheta, this.tmp);
        this.effects.spawnRing(this.tmp[0], this.tmp[1], this.tmp[2], this.tmp[3], this.tmp[4], this.tmp[5], e.lineage ? 0.35 : 0.2);
      } else if (e.type === SimEventType.DnaInjection && e.lineage) {
        const c = w.findCell(e.entityId);
        if (!c) continue;
        attachPoint(c, c.attachU, c.attachTheta, this.tmp);
        this.effects.spawnRing(this.tmp[0], this.tmp[1], this.tmp[2], this.tmp[3], this.tmp[4], this.tmp[5], 0.5);
      }
    }
  }

  frame(dt: number, alpha: number, time: number): void {
    const w = this.world;
    this.cam.update(dt);
    const camDist = this.cam.distance;
    this.cellUniforms.uTime.value = time;
    this.env.update(time, this.pixelScale, camDist);
    if (w) {
      // which cell (if any) is shown at interior scale
      let focusCell: Bacterium | null = null;
      const tracked = w.trackedInfo();
      if (this.selection?.kind === 'cell') focusCell = w.findCell(this.selection.id);
      else if (this.selection?.kind === 'phage' && this.selection.id === w.trackedPhageId && tracked.host) focusCell = tracked.host;
      let amount = 0;
      if (focusCell) {
        const d = this.camera.position.distanceTo(this.v.set(focusCell.x, focusCell.y, focusCell.z));
        amount = THREE.MathUtils.clamp((16 - d) / 9, 0, 1);
        if (focusCell.state === BacteriaState.Dead) amount = 0;
      }
      this.heroCell.update(w, amount > 0 ? focusCell : null, amount, time);
      this.heroCellId = amount > 0.25 && focusCell ? focusCell.id : -1;

      this.bacteria.hiddenId = this.heroCellId;
      this.bacteria.highlightId = this.selection?.kind === 'cell' ? this.selection.id : tracked.hostId;
      this.bacteria.update(w);

      // the tracked phage as an articulated model when close enough to matter
      let heroShown = false;
      this.phages.hideTrackedId = -1;
      if (tracked.state === PhageState.Free && tracked.phage) {
        const i = w.phageSystem.indexOf(tracked.phageId);
        const p = tracked.phage;
        const x = p.px + (p.x - p.px) * alpha;
        const y = p.py + (p.y - p.py) * alpha;
        const z = p.pz + (p.z - p.pz) * alpha;
        if (i >= 0 && this.camera.position.distanceTo(this.v.set(x, y, z)) < 5) {
          this.heroPhage.poseFree(x, y, z, p.id, time, dt);
          heroShown = true;
        }
      } else if (tracked.host && tracked.host.stage <= InfectionStage.Injecting) {
        if (this.camera.position.distanceTo(this.v.set(tracked.x, tracked.y, tracked.z)) < 9) {
          this.heroPhage.poseBound(w, tracked.host, time, dt);
          heroShown = true;
        }
      }
      this.heroPhage.group.visible = heroShown;
      this.heroPhageShown = heroShown;
      if (heroShown) this.phages.hideTrackedId = tracked.phageId;
      this.phages.nearFade = 4;
      this.phages.update(w, alpha, this.camera, this.pixelScale, time);
      this.cloud.update(w, this.pixelScale, time);
      this.effects.update(dt, this.pixelScale);
    }
    this.post.render(time, camDist);
  }

  pick(ndcX: number, ndcY: number, width: number, height: number): Selection {
    const w = this.world;
    if (!w) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const cellHit = this.bacteria.pick(w, ray.ray);
    const phageHit = this.phages.pick(w, this.camera, ndcX, ndcY, width, height);
    if (phageHit && (!cellHit || phageHit.depth < cellHit.distance + 0.3)) return { kind: 'phage', id: phageHit.id };
    if (cellHit) return { kind: 'cell', id: cellHit.cell.id };
    return null;
  }

  /** Ray hit on the mucus surface plane raised by `height` (placement of the initial phage). */
  pickPlacement(ndcX: number, ndcY: number, height: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Project a world point to CSS pixels; returns false when behind the camera. */
  project(p: THREE.Vector3, out: THREE.Vector2, width: number, height: number): boolean {
    this.v.copy(p).project(this.camera);
    if (this.v.z > 1) return false;
    out.set(((this.v.x + 1) / 2) * width, ((1 - this.v.y) / 2) * height);
    return true;
  }
}
