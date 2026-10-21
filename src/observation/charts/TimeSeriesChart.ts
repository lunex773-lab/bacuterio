import { fmtInt, fmtTime, t } from '../../i18n/i18n';
import { h, setText } from '../dom';

export interface SeriesDef {
  label: () => string;
  color: string;
}

export interface ChartPoint {
  t: number;
  v: number[];
}

/**
 * Small-multiple line chart on canvas: thin 2px lines, recessive grid, one y-axis,
 * crosshair + tooltip listing every series, legend, and a table view.
 */
export class TimeSeriesChart {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tip: HTMLDivElement;
  private readonly legend: HTMLDivElement;
  private readonly table: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly tableBtn: HTMLButtonElement;
  private data: ChartPoint[] = [];
  private hoverX = -1;
  private showTable = false;
  private dirty = true;

  constructor(
    private readonly titleKey: () => string,
    private readonly series: SeriesDef[],
    private readonly log: boolean,
  ) {
    this.canvas = h('canvas', { role: 'img' });
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = h('div', { class: 'tooltip' });
    this.legend = h('div', { class: 'chart-legend' });
    this.table = h('div', { class: 'table-view' });
    this.table.style.display = 'none';
    this.title = h('span', { class: 'eyebrow' });
    this.tableBtn = h('button', { class: 'link-btn', onclick: () => this.toggleTable() });
    this.el = h(
      'div',
      { class: 'chart' },
      h('div', { class: 'card-head', style: 'margin-bottom:4px' }, this.title, this.tableBtn),
      this.canvas,
      this.tip,
      this.legend,
      this.table,
    );
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = -1;
      this.tip.style.display = 'none';
      this.dirty = true;
    });
    this.relabel();
  }

  relabel(): void {
    setText(this.title, this.titleKey());
    setText(this.tableBtn, t('chart.table'));
    this.canvas.setAttribute('aria-label', this.titleKey());
    this.legend.textContent = '';
    for (const s of this.series) {
      const key = h('i', { class: 'key line' });
      key.style.background = s.color;
      this.legend.appendChild(h('span', {}, key, s.label()));
    }
    this.dirty = true;
  }

  setData(d: ChartPoint[]): void {
    this.data = d;
    this.dirty = true;
  }

  private toggleTable(): void {
    this.showTable = !this.showTable;
    this.table.style.display = this.showTable ? 'block' : 'none';
    this.dirty = true;
  }

  draw(): void {
    if (!this.dirty || this.el.offsetParent === null) return;
    this.dirty = false;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(cssW * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const padL = 34;
    const padR = 6;
    const padT = 6;
    const padB = 16;
    const W = cssW - padL - padR;
    const H = cssH - padT - padB;
    const d = this.data;

    let maxV = 1;
    for (const p of d) for (const v of p.v) if (v > maxV) maxV = v;
    const t0 = d.length ? d[0].t : 0;
    const t1 = d.length ? Math.max(d[d.length - 1].t, t0 + 60) : 60;
    const xOf = (tt: number) => padL + ((tt - t0) / (t1 - t0)) * W;
    let yOf: (v: number) => number;
    const ticks: number[] = [];
    if (this.log) {
      const top = Math.max(1, Math.ceil(Math.log10(maxV + 1)));
      yOf = (v) => padT + H - (Math.log10(v + 1) / top) * H;
      for (let k = 0; k <= top; k++) ticks.push(Math.pow(10, k) - (k === 0 ? 1 : 0));
    } else {
      const step = niceStep(maxV / 3);
      const top = Math.ceil(maxV / step) * step;
      yOf = (v) => padT + H - (v / top) * H;
      for (let v = 0; v <= top; v += step) ticks.push(v);
    }

    // recessive grid + axis labels
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of ticks) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = 'rgba(159,232,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
      ctx.fillStyle = '#6f8b93';
      ctx.fillText(compact(v), padL - 5, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${Math.round(t0 / 60)}${t('units.min')}`, padL, cssH - 3);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(t1 / 60)}${t('units.min')}`, padL + W, cssH - 3);

    // series
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let s = 0; s < this.series.length; s++) {
      ctx.strokeStyle = this.series[s].color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < d.length; i++) {
        const x = xOf(d[i].t);
        const y = yOf(d[i].v[s]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // crosshair + tooltip
    if (this.hoverX >= padL && d.length > 1) {
      const tt = t0 + ((this.hoverX - padL) / W) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < d.length; i++) if (Math.abs(d[i].t - tt) < Math.abs(d[best].t - tt)) best = i;
      const x = Math.round(xOf(d[best].t)) + 0.5;
      ctx.strokeStyle = 'rgba(238,247,249,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + H);
      ctx.stroke();
      for (let s = 0; s < this.series.length; s++) {
        ctx.fillStyle = '#06161d';
        ctx.beginPath();
        ctx.arc(x, yOf(d[best].v[s]), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.series[s].color;
        ctx.beginPath();
        ctx.arc(x, yOf(d[best].v[s]), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      this.renderTip(d[best], x, cssW);
    }

    if (this.showTable) this.renderTable();
  }

  private renderTip(p: ChartPoint, x: number, cssW: number): void {
    const tip = this.tip;
    tip.textContent = '';
    tip.appendChild(h('div', { class: 't-head' }, `${t('chart.time')} ${fmtTime(p.t)}`));
    for (let s = 0; s < this.series.length; s++) {
      const key = h('i', { class: 'key line' });
      key.style.background = this.series[s].color;
      tip.appendChild(h('div', { class: 't-row' }, h('span', {}, key, this.series[s].label()), h('b', {}, fmtInt(p.v[s]))));
    }
    tip.style.display = 'block';
    const w = 160;
    tip.style.left = `${Math.min(cssW - w, Math.max(0, x + 10))}px`;
    tip.style.top = '24px';
  }

  private renderTable(): void {
    const d = this.data;
    const rows = d.slice(-40).reverse();
    const head = h('tr', {}, h('th', {}, t('chart.time')), ...this.series.map((s) => h('th', {}, s.label())));
    const body = rows.map((p) => h('tr', {}, h('td', {}, fmtTime(p.t)), ...p.v.map((v) => h('td', {}, fmtInt(v)))));
    this.table.textContent = '';
    this.table.appendChild(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
  }
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function compact(v: number): string {
  if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
  if (v >= 1e3) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}
