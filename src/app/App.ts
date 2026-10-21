import * as THREE from 'three';
import { SimulationClock } from '../core/SimulationClock';
import { defaultConfig } from '../core/SimulationConfig';
import { SimulationWorld } from '../core/SimulationWorld';
import { onLangChange, setLang, lang, t } from '../i18n/i18n';
import { h } from '../observation/dom';
import { Hud, SPEEDS } from '../observation/hud/Hud';
import { deserialize, downloadSave, loadFromSlot, SaveData, saveToSlot } from '../save/SaveSystem';
import { BacteriaState } from '../simulation/bacteria/Bacterium';
import { PhageState } from '../simulation/phage/PhageAgent';
import { autoQuality, Quality, Selection, WorldRenderer } from '../visualization/WorldRenderer';
import { StartChoice, StartScreen } from './StartScreen';

type Phase = 'title' | 'placing' | 'observing';
type FollowMode = 'tracked' | 'selection' | 'none';

const QUALITY_KEY = 'phage-inner-world/quality';

/** Wires simulation, rendering and observation UI together and owns the frame loop. */
export class App {
  private readonly viewport: HTMLElement;
  private readonly ui: HTMLElement;
  private renderer: WorldRenderer;
  private world: SimulationWorld;
  private readonly clock = new SimulationClock();
  private readonly hud: Hud;
  private readonly start: StartScreen;
  private phase: Phase = 'title';
  private follow: FollowMode = 'tracked';
  private selection: Selection = null;
  private last = performance.now();
  private realTime = 0;
  private autosaveTimer = 0;
  private placement: HTMLElement | null = null;
  private placeCursor: HTMLElement;
  private lastTracked = -1;
  private readonly v = new THREE.Vector3();
  private readonly s1 = new THREE.Vector2();
  private readonly s2 = new THREE.Vector2();
  private qualityChoice: Quality | 'auto';

  constructor(viewport: HTMLElement, ui: HTMLElement) {
    this.viewport = viewport;
    this.ui = ui;
    document.documentElement.lang = lang();
    this.qualityChoice = readQuality();
    this.renderer = new WorldRenderer(viewport, this.resolveQuality(this.qualityChoice));
    // title background: an untouched biofilm, slowly orbiting
    this.world = new SimulationWorld(defaultConfig({ seed: 424242 }));
    this.renderer.setWorld(this.world);
    this.renderer.cam.controls.autoRotate = true;
    this.renderer.cam.controls.autoRotateSpeed = 0.35;
    this.renderer.camera.position.set(26, 9, 34);
    this.renderer.cam.controls.target.set(-4, 2, 0);

    this.hud = new Hud(ui, {
      togglePlay: () => this.togglePlay(),
      setSpeed: (s) => this.setSpeed(s),
      step: () => {
        if (this.phase === 'observing') {
          this.clock.paused = true;
          this.clock.stepOnce(() => this.world.advance());
        }
      },
      save: (slot) => this.hud.toast(saveToSlot(this.world, slot) ? t('menu.saved') : t('menu.failed')),
      load: (slot) => {
        const w = loadFromSlot(slot);
        if (w) this.enterWorld(w);
        this.hud.toast(w ? t('menu.loaded') : t('menu.failed'));
      },
      exportFile: () => downloadSave(this.world),
      importFile: (f) => this.importFile(f),
      restart: () => this.toTitle(),
      recenter: () => this.recenter(),
      overview: () => {
        this.follow = 'none';
        this.renderer.cam.overview();
      },
      toggleCutaway: () => this.renderer.cam.setCutaway(!this.renderer.cam.cutaway),
      toggleFollow: () => {
        this.follow = this.follow === 'none' ? 'tracked' : 'none';
        if (this.follow === 'tracked') this.recenter();
      },
      saveBookmark: () => this.renderer.cam.saveBookmark(`V${this.renderer.cam.loadBookmarks().length + 1}`),
      applyBookmark: (b) => {
        this.follow = 'none';
        this.renderer.cam.applyBookmark(b);
      },
      trackSelected: () => {
        if (this.selection?.kind === 'phage' && this.world.trackPhage(this.selection.id)) {
          this.follow = 'tracked';
          this.lastTracked = this.world.trackedPhageId;
        }
      },
      followSelection: () => {
        if (!this.selection) return;
        this.follow = this.selection.kind === 'phage' && this.selection.id === this.world.trackedPhageId ? 'tracked' : 'selection';
        if (this.renderer.entityPosition(this.selection, this.v, this.clock.alpha)) this.renderer.cam.flyTo(this.v, this.selection.kind === 'cell' ? 7 : 3.5);
      },
      bookmarks: () => this.renderer.cam.loadBookmarks(),
    });
    this.hud.worldRef = this.world;
    this.hud.setVisible(false);
    onLangChange(() => this.hud.relabel());

    this.start = new StartScreen(this.qualityChoice, (c) => this.begin(c), () => {
      const w = loadFromSlot(0);
      if (w) this.enterWorld(w);
    });
    ui.appendChild(this.start.el);
    this.placeCursor = h('div', { class: 'place-cursor' });
    ui.appendChild(this.placeCursor);

    this.bindInput();
    window.addEventListener('resize', () => this.renderer.resize(viewport.clientWidth, viewport.clientHeight));
    requestAnimationFrame((t0) => this.frame(t0));
  }

  private resolveQuality(q: Quality | 'auto'): Quality {
    return q === 'auto' ? autoQuality() : q;
  }

  // -------------------------------------------------------------- game flow

  private begin(c: StartChoice): void {
    if (c.quality !== this.qualityChoice) {
      this.qualityChoice = c.quality;
      try {
        localStorage.setItem(QUALITY_KEY, c.quality);
      } catch {
        /* ignore */
      }
      this.recreateRenderer(this.resolveQuality(c.quality));
    }
    const low = this.renderer.quality === 'low';
    const w = new SimulationWorld(
      defaultConfig({
        seed: c.seed,
        phageId: c.phageId,
        initialBacteria: c.cells,
        incompatibleFraction: c.nonHost,
        detailBudget: low ? 900 : 2500,
        maxBacteria: low ? 1300 : 1800,
      }),
    );
    this.setWorld(w);
    this.start.hide();
    this.phase = 'placing';
    this.clock.paused = true;
    this.renderer.cam.controls.autoRotate = false;
    this.renderer.cam.overview();
    this.showPlacement();
  }

  private enterWorld(w: SimulationWorld): void {
    this.setWorld(w);
    this.start.hide();
    this.placement?.remove();
    this.placement = null;
    this.renderer.cam.controls.autoRotate = false;
    if (!w.introduced) {
      this.phase = 'placing';
      this.renderer.cam.overview();
      this.showPlacement();
      return;
    }
    this.phase = 'observing';
    this.hud.setVisible(true);
    this.clock.paused = true;
    this.follow = 'tracked';
    this.selection = w.trackedPhageId >= 0 ? { kind: 'phage', id: w.trackedPhageId } : null;
    this.lastTracked = w.trackedPhageId;
    this.recenter();
  }

  private setWorld(w: SimulationWorld): void {
    this.world = w;
    this.renderer.setWorld(w);
    this.hud.worldRef = w;
    this.selection = null;
    this.renderer.cam.setCutaway(false);
    w.events.drain();
  }

  private toTitle(): void {
    this.phase = 'title';
    this.clock.paused = true;
    this.placement?.remove();
    this.placement = null;
    this.hud.setVisible(false);
    this.renderer.cam.controls.autoRotate = true;
    this.renderer.cam.following = false;
    this.renderer.cam.flyTo(new THREE.Vector3(0, 2, 0), 85, 1.6);
    this.start.show();
  }

  private recreateRenderer(q: Quality): void {
    const old = this.renderer;
    old.renderer.dispose();
    old.renderer.forceContextLoss();
    old.renderer.domElement.remove();
    this.renderer = new WorldRenderer(this.viewport, q);
    this.renderer.camera.position.copy(old.camera.position);
    this.renderer.cam.controls.target.copy(old.cam.controls.target);
    this.bindCanvas();
  }

  private showPlacement(): void {
    this.placement?.remove();
    this.placement = h(
      'div',
      { class: 'placement panel' },
      h('h3', {}, t('place.title')),
      h('p', {}, t('place.hint')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => this.autoPlace() }, t('place.auto'))),
    );
    this.ui.appendChild(this.placement);
  }

  private autoPlace(): void {
    const w = this.world;
    const hosts = w.bacteria.filter((b) => w.isHostSpecies(b.species) && b.state !== BacteriaState.Dead);
    hosts.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
    const c = hosts[Math.floor(Math.random() * Math.min(25, hosts.length))];
    this.introduce(new THREE.Vector3(c.x + 0.8, c.y + 1.6, c.z + 0.4));
  }

  private introduce(p: THREE.Vector3): void {
    const w = this.world;
    const id = w.introducePhage(p.x, p.y, p.z);
    this.placement?.remove();
    this.placement = null;
    this.placeCursor.style.display = 'none';
    this.phase = 'observing';
    this.hud.setVisible(true);
    this.selection = { kind: 'phage', id };
    this.follow = 'tracked';
    this.lastTracked = id;
    this.renderer.cam.following = true;
    this.renderer.cam.flyTo(p, 3.2, 2.4);
    this.clock.paused = false;
    this.clock.speed = 5;
  }

  private placementPoint(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const sel = this.renderer.pick(ndcX, ndcY, this.viewport.clientWidth, this.viewport.clientHeight);
    if (sel?.kind === 'cell') {
      const c = this.world.findCell(sel.id);
      if (c) return new THREE.Vector3(c.x, c.y + c.radius + 1.4, c.z);
    }
    const p = this.renderer.pickPlacement(ndcX, ndcY, 3);
    if (!p) return null;
    const e = this.world.env.params;
    if (Math.abs(p.x) > e.sizeX / 2 || Math.abs(p.z) > e.sizeZ / 2) return null;
    return p;
  }

  // ------------------------------------------------------------- controls

  private togglePlay(): void {
    if (this.phase !== 'observing') return;
    this.clock.paused = !this.clock.paused;
  }

  private setSpeed(s: number): void {
    this.clock.speed = s;
    if (this.phase === 'observing') this.clock.paused = false;
  }

  private recenter(): void {
    this.follow = 'tracked';
    const id = this.world.trackedPhageId;
    if (id < 0) return;
    this.selection = { kind: 'phage', id };
    if (this.renderer.entityPosition(this.selection, this.v, this.clock.alpha)) {
      const host = this.world.trackedInfo().host;
      this.renderer.cam.flyTo(this.v, host ? 6.5 : 3.2, 1.4);
    }
  }

  private async importFile(f: File): Promise<void> {
    try {
      const data = JSON.parse(await f.text()) as SaveData;
      this.enterWorld(deserialize(data));
      this.hud.toast(t('menu.loaded'));
    } catch (e) {
      this.hud.toast(`${t('menu.failed')}: ${(e as Error).message}`);
    }
  }

  private bindInput(): void {
    this.bindCanvas();
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || this.phase === 'title') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key >= '1' && e.key <= '5') this.setSpeed(SPEEDS[Number(e.key) - 1]);
      else if (e.key === 'f' || e.key === 'F') this.recenter();
      else if (e.key === 'c' || e.key === 'C') this.renderer.cam.setCutaway(!this.renderer.cam.cutaway);
      else if (e.key === 'o' || e.key === 'O') {
        this.follow = 'none';
        this.renderer.cam.overview();
      } else if (e.key === 'l' || e.key === 'L') setLang(lang() === 'ja' ? 'en' : 'ja');
    });
    document.addEventListener('visibilitychange', () => {
      // returning from the background must not jump the simulation (clock clamps long frames)
      this.last = performance.now();
    });
  }

  private bindCanvas(): void {
    const canvas = this.renderer.renderer.domElement;
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let lastClick = 0;
    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
      // a manual drag means the viewer wants to look around: stop auto-follow drift
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.phase !== 'placing' || e.pointerType === 'touch') return;
      const p = this.placementPoint(...this.ndc(e));
      this.placeCursor.style.display = p ? 'block' : 'none';
      this.placeCursor.style.left = `${e.clientX}px`;
      this.placeCursor.style.top = `${e.clientY}px`;
    });
    canvas.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 7 || performance.now() - downT > 450) return;
      const [nx, ny] = this.ndc(e);
      if (this.phase === 'placing') {
        const p = this.placementPoint(nx, ny);
        if (p) this.introduce(p);
        return;
      }
      if (this.phase !== 'observing') return;
      const now = performance.now();
      const sel = this.renderer.pick(nx, ny, this.viewport.clientWidth, this.viewport.clientHeight);
      const dbl = now - lastClick < 320;
      lastClick = now;
      this.selection = sel;
      if (sel) {
        if (window.innerWidth <= 820) this.hud.setTab('inspect');
        if (dbl) {
          this.follow = sel.kind === 'phage' && sel.id === this.world.trackedPhageId ? 'tracked' : 'selection';
          if (this.renderer.entityPosition(sel, this.v, this.clock.alpha)) this.renderer.cam.flyTo(this.v, sel.kind === 'cell' ? 6 : 2.6);
        }
      }
    });
  }

  private ndc(e: PointerEvent): [number, number] {
    const r = this.viewport.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  }

  // ------------------------------------------------------------- the loop

  private frame(now: number): void {
    requestAnimationFrame((t1) => this.frame(t1));
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += dt;
    const w = this.world;
    const r = this.renderer;

    if (this.phase === 'observing') {
      this.clock.tick(dt, w.config.dt, () => w.advance());
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 60 && !this.clock.paused) {
        this.autosaveTimer = 0;
        saveToSlot(w, 0);
      }
    }
    const events = w.events.drain();
    if (this.phase === 'observing') {
      r.handleEvents(events);
      this.hud.notify(w, events);
    }

    // the tracked lineage moved on (progeny / sibling): keep the selection on it
    if (w.trackedPhageId !== this.lastTracked) {
      if (this.selection?.kind === 'phage' && this.selection.id === this.lastTracked) this.selection = w.trackedPhageId >= 0 ? { kind: 'phage', id: w.trackedPhageId } : null;
      this.lastTracked = w.trackedPhageId;
    }

    // camera follow target
    let hasTarget = false;
    if (this.phase === 'observing') {
      if (this.follow === 'tracked' && w.trackedInfo().state !== PhageState.Lost) {
        hasTarget = r.entityPosition({ kind: 'phage', id: w.trackedPhageId }, this.v, this.clock.alpha);
      } else if (this.follow === 'selection') hasTarget = r.entityPosition(this.selection, this.v, this.clock.alpha);
    }
    r.cam.setFollowTarget(hasTarget ? this.v : null);
    r.cam.following = hasTarget;
    r.selection = this.selection;
    r.frame(dt, this.clock.alpha, this.realTime);

    if (this.phase === 'observing') {
      const W = this.viewport.clientWidth;
      const H = this.viewport.clientHeight;
      let trackedScreen: THREE.Vector2 | null = null;
      if (w.trackedPhageId >= 0 && r.entityPosition({ kind: 'phage', id: w.trackedPhageId }, this.v, this.clock.alpha) && !r.heroPhageShown) {
        if (r.project(this.v, this.s1, W, H)) trackedScreen = this.s1;
      }
      let selectionScreen: THREE.Vector2 | null = null;
      if (this.selection && r.entityPosition(this.selection, this.v, this.clock.alpha)) {
        if (r.project(this.v, this.s2, W, H)) selectionScreen = this.s2;
      }
      const dist = r.cam.distance;
      this.hud.update(
        {
          world: w,
          paused: this.clock.paused,
          speed: this.clock.speed,
          saturated: this.clock.saturated,
          selection: this.selection,
          following: this.follow !== 'none',
          cutaway: r.cam.cutaway,
          cameraDistance: dist,
          worldPerPx: (2 * dist * Math.tan(THREE.MathUtils.degToRad(r.camera.fov) / 2)) / H,
          heroInterior: r.heroCellId >= 0,
          trackedScreen,
          selectionScreen,
        },
        dt,
      );
    }
  }
}

function readQuality(): Quality | 'auto' {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'high' || q === 'medium' || q === 'low' || q === 'auto') return q;
  } catch {
    /* ignore */
  }
  return 'auto';
}
