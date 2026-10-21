import * as THREE from 'three';
import { MilestoneKind, SimEvent, SimEventType } from '../../core/EventQueue';
import {
  ENVIRONMENT_SPEC,
  getPhageSpec,
  MODEL_VERSION,
  ParamMeta,
  SPECIES_SPECS,
} from '../../core/SimulationConfig';
import { SimulationWorld } from '../../core/SimulationWorld';
import { fmtInt, fmtTime, I18nKey, lang, loc, setLang, t, tk } from '../../i18n/i18n';
import { slotInfo } from '../../save/SaveSystem';
import { BacteriaState, Bacterium, InfectionStage } from '../../simulation/bacteria/Bacterium';
import { InfectionSystem } from '../../simulation/infection/InfectionSystem';
import { PhageState } from '../../simulation/phage/PhageAgent';
import { CameraBookmark } from '../../visualization/camera/CameraController';
import { CELL_COLORS, CellLook } from '../../visualization/materials/CellMaterial';
import { cellLook } from '../../visualization/instancing/BacteriaView';
import { Selection } from '../../visualization/WorldRenderer';
import { TimeSeriesChart } from '../charts/TimeSeriesChart';
import { h, ICONS, LIFECYCLE_ICONS, setText, STATE_GLYPHS } from '../dom';

export const SPEEDS = [1, 5, 20, 60, 180];

export interface HudActions {
  togglePlay(): void;
  setSpeed(s: number): void;
  step(): void;
  save(slot: number): void;
  load(slot: number): void;
  exportFile(): void;
  importFile(f: File): void;
  restart(): void;
  recenter(): void;
  overview(): void;
  toggleCutaway(): void;
  toggleFollow(): void;
  saveBookmark(): void;
  applyBookmark(b: CameraBookmark): void;
  trackSelected(): void;
  followSelection(): void;
  bookmarks(): CameraBookmark[];
}

export interface HudFrame {
  world: SimulationWorld;
  paused: boolean;
  speed: number;
  saturated: boolean;
  selection: Selection;
  following: boolean;
  cutaway: boolean;
  cameraDistance: number;
  worldPerPx: number;
  heroInterior: boolean;
  trackedScreen: THREE.Vector2 | null;
  selectionScreen: THREE.Vector2 | null;
}

const LOOK_KEYS: { look: CellLook; key: I18nKey; glyph: keyof typeof STATE_GLYPHS }[] = [
  { look: CellLook.Susceptible, key: 'state.susceptible', glyph: 'susceptible' },
  { look: CellLook.Infected, key: 'state.infected', glyph: 'infected' },
  { look: CellLook.Resistant, key: 'state.resistant', glyph: 'resistant' },
  { look: CellLook.Dormant, key: 'state.inactive', glyph: 'dormant' },
  { look: CellLook.NonHost, key: 'state.nonhost', glyph: 'nonhost' },
];

/** Observation UI (design §2 Observation UI: time controls, tracking, statistics, event log). */
export class Hud {
  readonly root: HTMLElement;
  private readonly a: HudActions;
  private readonly refs: Record<string, HTMLElement> = {};
  private readonly phageChart: TimeSeriesChart;
  private readonly bactChart: TimeSeriesChart;
  private lastHistoryLen = -1;
  private lastLogKey = '';
  private lyticUntil = 0;
  private now = 0;
  private openTab: string | null = null;
  private relabelers: (() => void)[] = [];
  private seenEvents = 0;

  constructor(root: HTMLElement, actions: HudActions) {
    this.root = root;
    this.a = actions;
    this.phageChart = new TimeSeriesChart(() => t('chart.phage'), [
      { label: () => t('stats.free'), color: '#3987e5' },
      { label: () => t('stats.intracellular'), color: '#d95926' },
    ], true);
    this.bactChart = new TimeSeriesChart(() => t('chart.bacteria'), LOOK_KEYS.map((k) => ({ label: () => t(k.key), color: CELL_COLORS[k.look] })), false);
    this.build();
  }

  private L(key: I18nKey, el: HTMLElement = h('span')): HTMLElement {
    const f = () => setText(el, t(key));
    f();
    this.relabelers.push(f);
    return el;
  }

  relabel(): void {
    for (const f of this.relabelers) f();
    this.phageChart.relabel();
    this.bactChart.relabel();
    this.lastLogKey = '';
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    const r = this.refs;
    const a = this.a;

    // top bar
    r.play = h('button', { class: 'play', onclick: () => a.togglePlay(), 'aria-label': t('time.play') });
    const speedBtns = SPEEDS.map((s) => {
      const b = h('button', { onclick: () => a.setSpeed(s), 'data-speed': s }, `×${s}`);
      return b;
    });
    r.speeds = h('div', { style: 'display:contents' }, ...speedBtns);
    r.saturated = h('span', { class: 'saturated' });
    this.L('time.saturated', r.saturated);
    r.clock = h('div', { class: 'clock' });
    r.phageName = h('div', { class: 'brand-sub' });
    const brand = h(
      'div',
      { class: 'brand panel' },
      h('div', { class: 'brand-mark', html: BRAND_SVG }),
      h('div', {}, h('div', { class: 'brand-title' }, 'PHAGE: INNER WORLD'), r.phageName),
      h('div', { style: 'margin-left:auto;padding-left:10px' }, r.clock),
    );
    const transport = h(
      'div',
      { class: 'transport panel' },
      r.play,
      h('button', { onclick: () => a.step(), html: ICONS.step, title: t('time.step'), 'aria-label': t('time.step'), style: 'width:34px;display:grid;place-items:center' }),
      h('span', { class: 'sep' }),
      r.speeds,
      r.saturated,
    );
    r.langBtn = h('button', { class: 'icon-btn lang-btn', onclick: () => setLang(lang() === 'ja' ? 'en' : 'ja') }, lang() === 'ja' ? 'EN' : 'JA');
    const tools = h(
      'div',
      { class: 'tools panel' },
      h('button', { class: 'icon-btn', html: ICONS.info, title: t('menu.model'), onclick: () => this.openModel() }),
      h('button', { class: 'icon-btn', html: ICONS.save, title: t('menu.save'), onclick: () => this.openSaves() }),
      h('button', { class: 'icon-btn', html: ICONS.help, title: t('menu.help'), onclick: () => this.openHelp() }),
      h('button', { class: 'icon-btn', html: ICONS.restart, title: t('menu.restart'), onclick: () => a.restart() }),
      r.langBtn,
    );
    this.root.appendChild(h('div', { class: 'topbar' }, brand, transport, tools));

    // left column: populations, charts, log
    r.phageTotal = h('div', { class: 'stat-big' });
    r.phageSplit = h('div', { class: 'stat-sub' });
    r.intra = h('div', { class: 'stat-big', style: 'font-size:20px' });
    const phageGlyph = h('span', { class: 'glyph', html: STATE_GLYPHS.phage, style: 'color:#7dfde0' });
    const intraGlyph = h('span', { class: 'glyph', html: STATE_GLYPHS.intracellular, style: 'color:#d95926' });
    r.bar = h('div', { class: 'bar' });
    const rows = LOOK_KEYS.map((k) => {
      const v = h('span', { class: 'value' });
      r['n' + k.look] = v;
      const g = h('span', { class: 'glyph', html: STATE_GLYPHS[k.glyph] });
      g.style.color = CELL_COLORS[k.look];
      return h('div', { class: 'stat-row' }, h('span', { class: 'label' }, g, this.L(k.key)), v);
    });
    r.lysed = h('span', { class: 'value' });
    r.nutrient = h('span', { class: 'value' });
    const stats = h(
      'section',
      { class: 'panel card sheet-section', 'data-tab': 'stats' },
      h('div', { class: 'card-head' }, this.L('stats.title', h('span', { class: 'card-title' }))),
      h(
        'div',
        { class: 'stat-grid' },
        h('div', {}, h('div', { class: 'eyebrow', style: 'display:flex;gap:6px;align-items:center' }, phageGlyph, this.L('stats.free')), r.phageTotal, r.phageSplit),
        h('div', {}, h('div', { class: 'eyebrow', style: 'display:flex;gap:6px;align-items:center' }, intraGlyph, this.L('stats.intracellular')), r.intra),
      ),
      h('div', { class: 'divider' }),
      h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, this.L('stats.bacteria')),
      r.bar,
      h('div', { style: 'height:6px' }),
      ...rows,
      h('div', { class: 'divider' }),
      h('div', { class: 'stat-row' }, h('span', { class: 'label' }, this.L('stats.lysed')), r.lysed),
      h('div', { class: 'stat-row' }, h('span', { class: 'label' }, this.L('stats.nutrient')), r.nutrient),
    );
    const charts = h('section', { class: 'panel card sheet-section', 'data-tab': 'stats' }, this.phageChart.el, h('div', { style: 'height:12px' }), this.bactChart.el);
    r.log = h('ul', { class: 'log-list' });
    const log = h(
      'section',
      { class: 'panel card log sheet-section', 'data-tab': 'log' },
      h('div', { class: 'card-head' }, this.L('log.title', h('span', { class: 'card-title' }))),
      h('div', { class: 'scroll', style: 'flex:1' }, r.log),
    );
    r.left = h('div', { class: 'col left' }, h('button', { class: 'icon-btn sheet-close', html: ICONS.close, onclick: () => this.setTab(null) }), h('div', { class: 'scroll', style: 'display:flex;flex-direction:column;gap:10px;min-height:0;flex:1' }, stats, charts, log));
    this.root.appendChild(r.left);

    // right column: tracked phage, selection, camera
    r.trackedChip = h('span', { class: 'num small', style: 'color:var(--tracked)' });
    r.lifecycle = h('div', { class: 'lifecycle' });
    for (let i = 0; i < 4; i++) {
      const lbl = h('span');
      const node = h('div', { class: 'node' }, h('span', { html: LIFECYCLE_ICONS[i] }), lbl);
      const f = () => setText(lbl, tk(`phage.state.${i}`));
      f();
      this.relabelers.push(f);
      r.lifecycle.appendChild(node);
    }
    r.lysoNote = h('div', { class: 'lysogenic-note' });
    this.relabelers.push(() => setText(r.lysoNote, `${tk('phage.state.4')}`));
    r.stateDesc = h('div', { class: 'state-desc' });
    r.infection = h('div');
    r.trackedKv = h('dl', { class: 'kv' });
    r.lineage = h('div', { class: 'lineage' });
    r.followBtn = h('button', { class: 'btn', onclick: () => a.toggleFollow() });
    const tracked = h(
      'section',
      { class: 'panel card sheet-section', 'data-tab': 'inspect' },
      h('div', { class: 'card-head' }, this.L('inspector.tracked', h('span', { class: 'card-title' })), r.trackedChip),
      r.lifecycle,
      r.lysoNote,
      r.stateDesc,
      r.infection,
      r.trackedKv,
      h('div', { class: 'eyebrow', style: 'margin-top:12px' }, this.L('inspector.lineage')),
      r.lineage,
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => a.recenter() }, h('span', { html: ICONS.target }), this.L('camera.recenter')),
        r.followBtn,
      ),
    );
    r.selBody = h('div');
    r.selection = h('section', { class: 'panel card sheet-section', 'data-tab': 'inspect' }, r.selBody);
    r.cutBtn = h('button', { class: 'btn', onclick: () => a.toggleCutaway() }, h('span', { html: ICONS.cut }), this.L('camera.cutaway'));
    r.bookmarks = h('div', { class: 'btn-row', style: 'margin-top:8px' });
    const camera = h(
      'section',
      { class: 'panel card sheet-section', 'data-tab': 'camera' },
      h('div', { class: 'card-head' }, this.L('camera.title', h('span', { class: 'card-title' }))),
      h(
        'div',
        { class: 'btn-row', style: 'margin-top:0' },
        h('button', { class: 'btn', onclick: () => a.overview() }, h('span', { html: ICONS.overview }), this.L('camera.overview')),
        r.cutBtn,
        h('button', { class: 'btn', onclick: () => { a.saveBookmark(); this.renderBookmarks(); } }, h('span', { html: ICONS.bookmark }), this.L('camera.saveView')),
      ),
      r.bookmarks,
    );
    r.right = h('div', { class: 'col right' }, h('button', { class: 'icon-btn sheet-close', html: ICONS.close, onclick: () => this.setTab(null) }), h('div', { class: 'scroll', style: 'display:flex;flex-direction:column;gap:10px;min-height:0' }, tracked, r.selection, camera));
    this.root.appendChild(r.right);
    this.renderBookmarks();

    // scale bar + zoom ladder
    r.ruler = h('div', { class: 'ruler' });
    r.rulerVal = h('div', { class: 'val' });
    r.ladder = h('div', { class: 'ladder' });
    const levels: [I18nKey, boolean][] = [
      ['scale.body', true], ['scale.organ', true], ['scale.tissue', true],
      ['scale.community', false], ['scale.cell', false], ['scale.interior', false],
    ];
    for (const [k, future] of levels) {
      const lv = h('div', { class: 'lv' + (future ? ' future' : '') }, h('i'), this.L(k));
      if (future) {
        const f = () => lv.setAttribute('title', t('scale.future'));
        f();
        this.relabelers.push(f);
      }
      r.ladder.appendChild(lv);
    }
    r.scalebox = h('div', { class: 'scalebox panel' }, h('div', { class: 'scalebar' }, r.ruler, r.rulerVal), r.ladder);
    this.root.appendChild(r.scalebox);

    // screen-space markers
    r.marker = h('div', { class: 'marker passthrough' }, h('div', { class: 'ring' }), h('div', { class: 'tag' }));
    r.selMarker = h('div', { class: 'marker sel passthrough' }, h('div', { class: 'ring' }), h('div', { class: 'tag' }));
    this.root.appendChild(r.marker);
    this.root.appendChild(r.selMarker);

    r.toasts = h('div', { class: 'toast-wrap' });
    this.root.appendChild(r.toasts);

    // mobile tab bar
    const tab = (id: string, icon: string, key: I18nKey) =>
      h('button', { 'data-tab': id, onclick: () => this.setTab(this.openTab === id ? null : id) }, h('span', { html: icon }), this.L(key));
    r.tabbar = h(
      'nav',
      { class: 'tabbar panel' },
      tab('stats', ICONS.stats, 'stats.title'),
      tab('log', ICONS.log, 'log.title'),
      tab('inspect', ICONS.inspect, 'inspector.title'),
      tab('camera', ICONS.camera, 'camera.title'),
    );
    this.root.appendChild(r.tabbar);
  }

  /** Mobile bottom-sheet tabs. */
  setTab(id: string | null): void {
    this.openTab = id;
    const r = this.refs;
    for (const b of Array.from(r.tabbar.querySelectorAll('button'))) b.classList.toggle('on', b.getAttribute('data-tab') === id);
    const leftTabs = ['stats', 'log'];
    r.left.classList.toggle('open', id !== null && leftTabs.includes(id));
    r.right.classList.toggle('open', id !== null && !leftTabs.includes(id));
    for (const s of Array.from(this.root.querySelectorAll('.sheet-section'))) s.classList.toggle('show', s.getAttribute('data-tab') === id);
  }

  private renderBookmarks(): void {
    const r = this.refs;
    r.bookmarks.textContent = '';
    for (const b of this.a.bookmarks()) {
      r.bookmarks.appendChild(h('button', { class: 'btn', onclick: () => this.a.applyBookmark(b) }, h('span', { html: ICONS.bookmark }), b.name));
    }
  }

  // ----------------------------------------------------------------- update

  update(f: HudFrame, dtReal: number): void {
    this.now += dtReal;
    const r = this.refs;
    const w = f.world;
    setText(r.clock, `T+${fmtTime(w.time)}`);
    setText(r.phageName, loc(getPhageSpec(w.config.phageId).name));
    r.play.innerHTML = f.paused ? ICONS.play : ICONS.pause;
    r.play.setAttribute('aria-label', f.paused ? t('time.play') : t('time.pause'));
    for (const b of Array.from(r.speeds.children)) b.classList.toggle('active', Number(b.getAttribute('data-speed')) === f.speed);
    r.saturated.classList.toggle('on', f.saturated && !f.paused);
    setText(r.langBtn, lang() === 'ja' ? 'EN' : 'JA');

    // populations
    const s = w.snapshot();
    setText(r.phageTotal, fmtInt(s.freeIndividual + s.freePopulation));
    setText(r.phageSplit, `${t('stats.individual')} ${fmtInt(s.freeIndividual)} · ${t('stats.population')} ${fmtInt(s.freePopulation)}`);
    setText(r.intra, fmtInt(s.intracellular));
    const vals = [s.susceptible, s.infected, s.resistant, s.inactive, s.nonHost];
    LOOK_KEYS.forEach((k, i) => setText(r['n' + k.look], fmtInt(vals[i])));
    const total = Math.max(1, vals.reduce((x, y) => x + y, 0));
    if (r.bar.children.length !== 5) {
      r.bar.textContent = '';
      for (const k of LOOK_KEYS) {
        const sp = h('span');
        sp.style.background = CELL_COLORS[k.look];
        r.bar.appendChild(sp);
      }
    }
    vals.forEach((v, i) => ((r.bar.children[i] as HTMLElement).style.width = `${(v / total) * 100}%`));
    setText(r.lysed, fmtInt(s.lysedTotal));
    setText(r.nutrient, `${Math.round(w.env.meanNutrient() * 100)}%`);

    if (w.history.length !== this.lastHistoryLen) {
      this.lastHistoryLen = w.history.length;
      const hist = w.history.concat([s]);
      this.phageChart.setData(hist.map((p) => ({ t: p.t, v: [p.freeIndividual + p.freePopulation, p.intracellular] })));
      this.bactChart.setData(hist.map((p) => ({ t: p.t, v: [p.susceptible, p.infected, p.resistant, p.inactive, p.nonHost] })));
    }
    this.phageChart.draw();
    this.bactChart.draw();

    this.updateLog(w);
    this.updateTracked(f);
    this.updateSelection(f);
    r.followBtn.classList.toggle('on', f.following);
    r.followBtn.textContent = '';
    r.followBtn.append(h('span', { html: ICONS.follow }), f.following ? t('camera.followOn') : t('camera.followOff'));
    r.cutBtn.classList.toggle('on', f.cutaway);

    // scale bar
    const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
    let L = nice[0];
    for (const n of nice) if (n / f.worldPerPx <= 120) L = n;
    r.ruler.style.width = `${Math.max(16, L / f.worldPerPx)}px`;
    setText(r.rulerVal, L < 1 ? `${Math.round(L * 1000)} nm` : `${L} µm`);
    const level = f.heroInterior || f.cameraDistance < 2.5 ? 5 : f.cameraDistance < 22 ? 4 : 3;
    Array.from(r.ladder.children).forEach((c, i) => c.classList.toggle('on', i === level));

    this.placeMarker(r.marker, f.trackedScreen, this.trackedTag(w));
    const showSel = f.selection && !(f.selection.kind === 'phage' && f.selection.id === w.trackedPhageId);
    this.placeMarker(r.selMarker, showSel ? f.selectionScreen : null, f.selection ? `#${f.selection.id}` : '');
  }

  private placeMarker(el: HTMLElement, p: THREE.Vector2 | null, tag: string): void {
    if (!p) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    setText(el.querySelector('.tag')!, tag);
  }

  private trackedTag(w: SimulationWorld): string {
    const ti = w.trackedInfo();
    if (ti.state === PhageState.Lost) return '';
    const g = ti.generation >= 0 ? `G${ti.generation}` : 'G?';
    return `#${ti.phageId} · ${g} · ${tk(`phage.state.${ti.state}`)}`;
  }

  private updateTracked(f: HudFrame): void {
    const r = this.refs;
    const w = f.world;
    const ti = w.trackedInfo();
    let state: number = ti.state;
    if (this.now < this.lyticUntil && ti.state === PhageState.Free) state = PhageState.Lytic;
    const order = [PhageState.Free, PhageState.Adsorbed, PhageState.Infected, PhageState.Lytic];
    const idx = order.indexOf(state);
    Array.from(r.lifecycle.children).forEach((n, i) => {
      n.classList.toggle('on', i === idx);
      n.classList.toggle('done', idx >= 0 && i < idx);
    });
    setText(r.trackedChip, ti.state === PhageState.Lost ? '—' : `#${ti.phageId} · ${ti.generation >= 0 ? `G${ti.generation}` : 'G?'}`);
    setText(r.stateDesc, tk(`phage.state.desc.${state}`));

    // infection timeline inside the host
    const host = ti.host;
    const key = host ? `h${host.id}` : 'none';
    if (r.infection.getAttribute('data-k') !== key) {
      r.infection.setAttribute('data-k', key);
      r.infection.textContent = '';
      if (host) {
        const track = h('div', { class: 'stage-track' });
        for (let i = 0; i < 5; i++) track.appendChild(h('div', {}, h('i')));
        r.infection.append(
          track,
          h('div', { class: 'stage-labels' }, h('span', {}, tk('stage.1')), h('span', {}, tk('stage.6'))),
          h('div', { class: 'stage-now' }, h('b'), h('p')),
        );
      }
    }
    if (host) this.fillStages(r.infection, host, w);

    const kv: [string, string][] = [];
    if (host) {
      const ecl = w.phageParams.eclipse;
      kv.push([t('inspector.host'), `#${host.id}`]);
      kv.push([t('inspector.inside'), fmtInt(InfectionSystem.matureCount(host, ecl))]);
      kv.push([t('inspector.expectedBurst'), fmtInt(host.burst)]);
      const remain = (host.latent - host.infTime) / InfectionSystem.clockRate(host);
      kv.push([t('inspector.lysisIn'), `${Math.max(0, remain / 60).toFixed(1)} ${t('units.min')}`]);
    } else if (ti.phage) {
      kv.push([t('inspector.id'), `#${ti.phage.id}`]);
      kv.push([t('inspector.parent'), ti.phage.parentId >= 0 ? `#${ti.phage.parentId}` : '—']);
      kv.push([t('inspector.age'), `${((w.time - ti.phage.bornTime) / 60).toFixed(1)} ${t('units.min')}`]);
    }
    this.fillKv(r.trackedKv, kv);

    const lin = w.lineage.slice(-6);
    const linKey = `${lang()}:${w.lineage.length}:${w.trackedPhageId}`;
    if (r.lineage.getAttribute('data-k') !== linKey) {
      r.lineage.setAttribute('data-k', linKey);
      r.lineage.textContent = '';
      lin.forEach((rec, i) => {
        if (i > 0) r.lineage.appendChild(h('span', { class: 'arrow' }, rec.kind === 'progeny' ? '→' : '⇢'));
        const chip = h('span', { class: 'chip' + (rec.phageId === w.trackedPhageId ? ' current' : '') }, `${rec.generation >= 0 ? 'G' + rec.generation : 'G?'} #${rec.phageId}`);
        chip.title = `${tk('lineage.' + rec.kind)}${rec.burst ? ` · burst ${rec.burst}` : ''}`;
        r.lineage.appendChild(chip);
      });
    }
  }

  private fillStages(el: HTMLElement, c: Bacterium, w: SimulationWorld): void {
    const pp = w.phageParams;
    const b0 = 0;
    const b1 = pp.adsorbPhase;
    const b2 = pp.adsorbPhase + pp.injectPhase;
    const b3 = Math.max(b2 + 30, pp.eclipse * 0.35);
    const b4 = pp.eclipse;
    const b5 = c.latent;
    const bounds = [b0, b1, b2, b3, b4, b5];
    const segs = el.querySelectorAll('.stage-track > div > i');
    for (let i = 0; i < 5; i++) {
      const p = Math.max(0, Math.min(1, (c.infTime - bounds[i]) / (bounds[i + 1] - bounds[i])));
      (segs[i] as HTMLElement).style.width = `${p * 100}%`;
    }
    const st = c.state === BacteriaState.Infected ? c.stage : InfectionStage.None;
    const now = el.querySelector('.stage-now')!;
    setText(now.querySelector('b')!, tk(`stage.${st}`));
    setText(now.querySelector('p')!, tk(`stage.desc.${st}`));
  }

  private fillKv(dl: HTMLElement, kv: [string, string][]): void {
    if (dl.children.length !== kv.length * 2) {
      dl.textContent = '';
      for (let i = 0; i < kv.length; i++) dl.append(h('dt'), h('dd'));
    }
    kv.forEach(([k, v], i) => {
      setText(dl.children[i * 2], k);
      setText(dl.children[i * 2 + 1], v);
    });
  }

  private updateSelection(f: HudFrame): void {
    const r = this.refs;
    const w = f.world;
    const sel = f.selection && !(f.selection.kind === 'phage' && f.selection.id === w.trackedPhageId) ? f.selection : null;
    const body = r.selBody;
    const key = sel ? `${sel.kind}${sel.id}:${lang()}` : `none:${lang()}`;
    if (body.getAttribute('data-k') !== key) {
      body.setAttribute('data-k', key);
      body.textContent = '';
      if (!sel) {
        body.append(h('div', { class: 'card-head' }, h('span', { class: 'card-title' }, t('inspector.title'))), h('p', { class: 'muted', style: 'margin:0;line-height:1.6' }, t('inspector.none')));
      } else if (sel.kind === 'cell') {
        body.append(
          h('div', { class: 'card-head' }, h('span', { class: 'card-title' }, t('inspector.cell')), h('span', { class: 'num small muted' }, `#${sel.id}`)),
          h('dl', { class: 'kv' }),
          h('div', { class: 'sel-inf' }),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => this.a.followSelection() }, h('span', { html: ICONS.follow }), t('inspector.follow'))),
        );
      } else {
        const tracked = sel.id === w.trackedPhageId;
        body.append(
          h('div', { class: 'card-head' }, h('span', { class: 'card-title' }, t('inspector.phage')), h('span', { class: 'num small muted' }, `#${sel.id}`)),
          h('dl', { class: 'kv' }),
          h(
            'div',
            { class: 'btn-row' },
            tracked ? null : h('button', { class: 'btn primary', onclick: () => this.a.trackSelected() }, h('span', { html: ICONS.target }), t('inspector.track')),
            h('button', { class: 'btn', onclick: () => this.a.followSelection() }, h('span', { html: ICONS.follow }), t('inspector.follow')),
          ),
        );
      }
    }
    if (!sel) return;
    const dl = body.querySelector('dl')!;
    if (sel.kind === 'cell') {
      const c = w.findCell(sel.id);
      if (!c) {
        this.fillKv(dl, [[t('inspector.state'), t('state.dead')]]);
        return;
      }
      const look = cellLook(w, c);
      const stateKey = LOOK_KEYS.find((k) => k.look === look)?.key ?? 'state.dead';
      const kv: [string, string][] = [
        [t('inspector.species'), loc(SPECIES_SPECS[c.species].name)],
        [t('inspector.state'), t(stateKey)],
        [t('inspector.length'), `${(2 * c.halfLength + 2 * c.radius).toFixed(2)} µm`],
        [t('inspector.activity'), `${Math.round(c.activity * 100)}%`],
      ];
      if (c.state === BacteriaState.Infected) {
        kv.push([t('inspector.stage'), tk(`stage.${c.stage}`)]);
        kv.push([t('inspector.inside'), fmtInt(InfectionSystem.matureCount(c, w.phageParams.eclipse))]);
        kv.push([t('inspector.expectedBurst'), fmtInt(c.burst)]);
        kv.push([t('inspector.excluded'), fmtInt(c.excluded)]);
      }
      this.fillKv(dl, kv);
    } else {
      const i = w.phageSystem.indexOf(sel.id);
      if (i < 0) {
        this.fillKv(dl, [[t('inspector.state'), tk('phage.state.5')]]);
        return;
      }
      const p = w.phages[i];
      this.fillKv(dl, [
        [t('inspector.state'), tk('phage.state.0')],
        [t('inspector.generation'), p.generation >= 0 ? String(p.generation) : t('inspector.genUnknown')],
        [t('inspector.parent'), p.parentId >= 0 ? `#${p.parentId}` : '—'],
        [t('inspector.age'), `${((w.time - p.bornTime) / 60).toFixed(1)} ${t('units.min')}`],
      ]);
    }
  }

  // ------------------------------------------------------------------ log

  private updateLog(w: SimulationWorld): void {
    const hist = w.events.history;
    const last = hist[hist.length - 1];
    const key = `${lang()}:${hist.length}:${last ? `${last.step}:${last.type}:${last.entityId}` : ''}`;
    if (key === this.lastLogKey) return;
    this.lastLogKey = key;
    const ul = this.refs.log;
    ul.textContent = '';
    if (hist.length === 0) {
      ul.appendChild(h('li', { class: 'log-empty' }, h('span'), h('span', {}, t('log.empty'))));
      return;
    }
    for (let i = hist.length - 1; i >= Math.max(0, hist.length - 80); i--) {
      const e = hist[i];
      const cls = e.type === SimEventType.Milestone ? 'milestone' : e.lineage ? 'lineage' : '';
      ul.appendChild(h('li', { class: cls }, h('span', { class: 'time' }, fmtTime(e.time)), h('span', { class: 'msg' }, this.describe(w, e))));
    }
  }

  describe(w: SimulationWorld, e: SimEvent): string {
    switch (e.type) {
      case SimEventType.Milestone:
        return tk(`milestone.${e.value}`);
      case SimEventType.TrackingChanged: {
        const rec = w.lineage.find((l) => l.phageId === e.entityId);
        return tk(`event.11.${e.value}`, { a: e.entityId, g: rec && rec.generation >= 0 ? rec.generation : '?' });
      }
      case SimEventType.Lysis:
        return tk('event.3', { a: e.entityId, v: e.value });
      default:
        return tk(`event.${e.type}`, { a: e.entityId, v: e.value });
    }
  }

  /** Toasts for milestones and key moments of the tracked lineage. */
  notify(w: SimulationWorld, events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === SimEventType.Lysis && e.lineage) this.lyticUntil = this.now + 2.8;
      const toast =
        e.type === SimEventType.Milestone ||
        (e.lineage && (e.type === SimEventType.Adsorption || e.type === SimEventType.DnaInjection || e.type === SimEventType.Lysis || e.type === SimEventType.PhageDecayed));
      if (!toast) continue;
      if (e.type === SimEventType.Milestone && e.value === MilestoneKind.Phage10000 && this.seenEvents > 40) continue;
      this.seenEvents++;
      this.toast(this.describe(w, e), e.type === SimEventType.Milestone ? 'milestone' : '');
    }
  }

  toast(msg: string, kind = ''): void {
    const el = h('div', { class: `toast panel ${kind}` }, msg);
    const wrap = this.refs.toasts;
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild!);
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 520);
    }, 3800);
  }

  setVisible(on: boolean): void {
    for (const k of ['left', 'right', 'scalebox', 'tabbar']) this.refs[k].style.visibility = on ? 'visible' : 'hidden';
    (this.root.querySelector('.topbar') as HTMLElement).style.visibility = on ? 'visible' : 'hidden';
    if (!on) {
      this.refs.marker.style.display = 'none';
      this.refs.selMarker.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------- modals

  private modal(titleKey: I18nKey, body: HTMLElement): void {
    const close = () => back.remove();
    const back = h(
      'div',
      { class: 'modal-back', onclick: (e: Event) => { if (e.target === back) close(); } },
      h(
        'div',
        { class: 'modal panel', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' }, h('h2', {}, t(titleKey)), h('button', { class: 'icon-btn', html: ICONS.close, 'aria-label': t('menu.close'), onclick: close })),
        h('div', { class: 'modal-body' }, body),
      ),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        window.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.appendChild(back);
  }

  worldRef: SimulationWorld | null = null;

  openModel(): void {
    const w = this.worldRef;
    if (!w) return;
    const spec = getPhageSpec(w.config.phageId);
    const rows: HTMLElement[] = [];
    const group = (name: string) => rows.push(h('tr', { class: 'group' }, h('td', { colspan: 4 }, name)));
    const row = (name: string, p: ParamMeta) =>
      rows.push(
        h(
          'tr',
          {},
          h('td', {}, name),
          h('td', { class: 'v' }, `${p.value} ${p.unit}`),
          h('td', {}, h('span', { class: `badge ${p.evidenceLevel}` }, tk(`evidence.${p.evidenceLevel}`)), h('br'), h('span', { class: 'badge mt' }, tk(`modeltype.${p.modelType}`))),
          h('td', {}, loc(p.source), h('div', { class: 'muted small', style: 'margin-top:3px' }, `${t('model.uncertainty')}: ${loc(p.uncertainty)}`)),
        ),
      );
    group(`${loc(spec.name)} — ${loc(spec.family)}`);
    for (const k in spec.params) row(k, spec.params[k as keyof typeof spec.params]);
    for (const sp of SPECIES_SPECS) {
      group(loc(sp.name));
      for (const k in sp.params) row(k, sp.params[k as keyof typeof sp.params]);
    }
    group(loc(ENVIRONMENT_SPEC.name));
    for (const k in ENVIRONMENT_SPEC.params) row(k, ENVIRONMENT_SPEC.params[k as keyof typeof ENVIRONMENT_SPEC.params]);

    const body = h(
      'div',
      {},
      h('p', {}, t('model.lead')),
      h(
        'div',
        { class: 'verify' },
        h('span', {}, `${t('model.version')} `, h('b', {}, MODEL_VERSION)),
        h('span', {}, `${t('model.seed')} `, h('b', {}, String(w.config.seed))),
        h('span', {}, `${t('model.hash')} `, h('b', {}, w.stateHash())),
        h('span', {}, 'step ', h('b', {}, String(w.step))),
      ),
      h('div', { class: 'eyebrow' }, t('model.assumptions')),
      h('ul', { class: 'assumptions' }, ...(['model.a1', 'model.a2', 'model.a3', 'model.a4', 'model.a5', 'model.a6'] as I18nKey[]).map((k) => h('li', {}, t(k)))),
      h(
        'table',
        { class: 'ptable' },
        h('thead', {}, h('tr', {}, h('th', {}, t('model.param')), h('th', {}, t('model.value')), h('th', {}, t('model.evidence')), h('th', {}, t('model.source')))),
        h('tbody', {}, ...rows),
      ),
    );
    this.modal('model.title', body);
  }

  openSaves(): void {
    const list = h('div', { class: 'slots' });
    const render = () => {
      list.textContent = '';
      for (const slot of [0, 1, 2, 3]) {
        const info = slotInfo(slot);
        const name = slot === 0 ? 'AUTO' : `${t('menu.slot')} ${slot}`;
        const meta = info
          ? `${new Date(info.savedAt).toLocaleString(lang() === 'ja' ? 'ja-JP' : 'en-US')} · ${info.phageId} · T+${fmtTime(info.time)} · ${t('stats.phage')} ${fmtInt(info.free)}`
          : t('menu.empty');
        list.appendChild(
          h(
            'div',
            { class: 'slot' },
            h('div', {}, h('div', {}, name), h('div', { class: 'meta' }, meta)),
            h(
              'div',
              { class: 'btn-row', style: 'margin:0' },
              slot === 0 ? null : h('button', { class: 'btn', onclick: () => { this.a.save(slot); render(); } }, t('menu.save')),
              info ? h('button', { class: 'btn primary', onclick: () => { this.a.load(slot); document.querySelector('.modal-back')?.remove(); } }, t('menu.load')) : null,
            ),
          ),
        );
      }
    };
    render();
    const file = h('input', { type: 'file', accept: 'application/json', style: 'display:none' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      if (file.files?.[0]) {
        this.a.importFile(file.files[0]);
        document.querySelector('.modal-back')?.remove();
      }
    });
    const body = h(
      'div',
      {},
      list,
      h(
        'div',
        { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn', onclick: () => this.a.exportFile() }, h('span', { html: ICONS.download }), t('menu.export')),
        h('button', { class: 'btn', onclick: () => file.click() }, h('span', { html: ICONS.upload }), t('menu.import')),
        file,
      ),
    );
    this.modal('menu.save', body);
  }

  openHelp(): void {
    this.modal('help.title', h('ul', { class: 'help-list' }, h('li', {}, t('help.mouse')), h('li', {}, t('help.touch')), h('li', {}, t('help.keys'))));
  }
}

const BRAND_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="#9ff7e6" stroke-width="1.4" stroke-linejoin="round">
  <polygon points="16,2 23,6 23,14 16,18 9,14 9,6" fill="rgba(159,247,230,0.14)"/>
  <path d="M9,6 16,10 23,6 M16,10 16,18"/>
  <path d="M14.5,18.5h3v7h-3z" fill="rgba(159,247,230,0.25)"/>
  <path d="M14.5,25.5 l-5,-2.5 l-3,7 M17.5,25.5 l5,-2.5 l3,7"/>
</svg>`;
