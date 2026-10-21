import { PHAGE_SPECS } from '../core/SimulationConfig';
import { fmtTime, I18nKey, lang, loc, onLangChange, setLang, t } from '../i18n/i18n';
import { h, phageArt, setText } from '../observation/dom';
import { slotInfo } from '../save/SaveSystem';
import { Quality } from '../visualization/WorldRenderer';

export interface StartChoice {
  phageId: string;
  seed: number;
  cells: number;
  nonHost: number;
  quality: Quality | 'auto';
}

/** Title / experiment setup screen shown over the slowly orbiting environment. */
export class StartScreen {
  readonly el: HTMLElement;
  private choice: StartChoice;

  constructor(
    initialQuality: Quality | 'auto',
    private readonly onBegin: (c: StartChoice) => void,
    private readonly onContinue: () => void,
  ) {
    this.choice = { phageId: 'T4', seed: Math.floor(Math.random() * 1e6), cells: 420, nonHost: 0.22, quality: initialQuality };
    this.el = h('div', { class: 'start' });
    this.render();
    onLangChange(() => this.render());
  }

  private render(): void {
    const c = this.choice;
    const L = (k: I18nKey) => t(k);
    const cards = PHAGE_SPECS.map((p) => {
      const lat = p.params.latentMean.value / 60;
      const burst = p.params.burstMean.value;
      const card = h(
        'button',
        { class: 'phage-card' + (c.phageId === p.id ? ' on' : ''), onclick: () => { c.phageId = p.id; this.render(); } },
        h('span', { html: phageArt(p.morphology), style: 'color:var(--accent)' }),
        h(
          'span',
          {},
          h('div', { class: 'nm' }, loc(p.name)),
          h('div', { class: 'fm' }, loc(p.family)),
          h('div', { class: 'pr' }, `${L('start.latent')} ~${Math.round(lat)} ${L('units.min')}`, h('br'), `${L('start.burst')} ~${burst}`, h('br'), `${L('start.host')} E. coli`),
        ),
      );
      card.setAttribute('aria-pressed', String(c.phageId === p.id));
      return card;
    });

    const seed = h('input', { type: 'number', value: c.seed, min: 0, max: 999999999 }) as HTMLInputElement;
    seed.addEventListener('change', () => (c.seed = Math.max(0, Math.floor(Number(seed.value) || 0))));
    const cellsVal = h('span', { class: 'range-val' }, String(c.cells));
    const cells = h('input', { type: 'range', min: 120, max: 700, step: 20, value: c.cells }) as HTMLInputElement;
    cells.addEventListener('input', () => {
      c.cells = Number(cells.value);
      setText(cellsVal, String(c.cells));
    });
    const nhVal = h('span', { class: 'range-val' }, `${Math.round(c.nonHost * 100)}%`);
    const nh = h('input', { type: 'range', min: 0, max: 0.6, step: 0.05, value: c.nonHost }) as HTMLInputElement;
    nh.addEventListener('input', () => {
      c.nonHost = Number(nh.value);
      setText(nhVal, `${Math.round(c.nonHost * 100)}%`);
    });
    const q = h('select') as HTMLSelectElement;
    for (const v of ['auto', 'high', 'medium', 'low'] as const) {
      const o = h('option', { value: v }, t(`quality.${v}` as I18nKey));
      if (v === c.quality) o.setAttribute('selected', '');
      q.appendChild(o);
    }
    q.addEventListener('change', () => (c.quality = q.value as StartChoice['quality']));

    const auto = slotInfo(0);
    const cont = auto
      ? h('button', { class: 'btn', onclick: () => this.onContinue() }, `${L('start.continue')} · ${auto.phageId} T+${fmtTime(auto.time)}`)
      : null;

    this.el.textContent = '';
    this.el.append(
      h(
        'div',
        {},
        h('div', { class: 'kicker' }, 'Observation simulator · v0.1'),
        h('h1', {}, 'PHAGE', h('b', {}, ':'), h('br'), 'Inner World'),
        h('p', { class: 'lead' }, L('start.lead')),
        h('p', { class: 'note' }, L('start.note')),
      ),
      h(
        'div',
        { class: 'setup panel' },
        h('div', { class: 'card-head', style: 'margin:0' }, h('span', { class: 'eyebrow' }, L('start.choosePhage')), h('button', { class: 'btn', onclick: () => setLang(lang() === 'ja' ? 'en' : 'ja') }, lang() === 'ja' ? 'English' : '日本語')),
        h('div', { class: 'phage-cards' }, ...cards),
        h('div', { class: 'eyebrow' }, L('start.settings')),
        h(
          'div',
          { class: 'field-grid' },
          h('div', { class: 'field' }, h('label', {}, L('start.seed')), seed),
          h('div', { class: 'field' }, h('label', {}, L('start.quality')), q),
          h('div', { class: 'field' }, h('label', {}, L('start.cells'), cellsVal), cells),
          h('div', { class: 'field' }, h('label', {}, L('start.nonhost'), nhVal), nh),
        ),
        h('div', { class: 'start-actions' }, h('button', { class: 'btn primary', onclick: () => this.onBegin({ ...c }) }, L('start.begin')), cont),
      ),
    );
  }

  hide(): void {
    this.el.classList.add('leaving');
    setTimeout(() => (this.el.style.display = 'none'), 700);
  }

  show(): void {
    this.el.classList.remove('leaving');
    this.el.style.display = '';
    this.render();
  }
}
