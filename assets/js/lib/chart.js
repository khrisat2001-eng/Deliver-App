// Minimal single-series bar chart (SVG) with hover tooltips. One series → no legend; the card title names it.
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

/** data: [{ label, value, tip }]. format(value) → string for axis/tooltip. */
export function barChart(data, { height = 200, format = String, labelEvery = 1, ariaLabel = '' } = {}) {
  const W = 640; const H = height; const padL = 8; const padR = 8; const padT = 10; const padB = 24; const axisW = 46;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = W - padL - padR - axisW;
  const plotH = H - padT - padB;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(28, slot - 2)); // 2px gap between adjacent bars
  const rtl = document.dir === 'rtl';
  const x0 = rtl ? padL : padL + axisW;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    svg.append(s('line', { x1: x0, x2: x0 + plotW, y1: y, y2: y, class: 'grid-line' }));
    const label = s('text', { x: rtl ? x0 + plotW + 6 : x0 - 6, y: y + 4, 'text-anchor': rtl ? 'start' : 'end', class: 'axis-label' });
    label.textContent = format((max * i) / 4);
    svg.append(label);
  }
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip hidden' });
  data.forEach((d, i) => {
    const idx = rtl ? data.length - 1 - i : i;
    const cx = x0 + slot * idx + slot / 2;
    const bh = (plotH * d.value) / max;
    const y = padT + plotH - bh;
    // bar with a 4px rounded top, square at the baseline
    const r = Math.min(4, barW / 2, bh);
    const path = bh > 0
      ? `M${cx - barW / 2},${padT + plotH} V${y + r} Q${cx - barW / 2},${y} ${cx - barW / 2 + r},${y} H${cx + barW / 2 - r} Q${cx + barW / 2},${y} ${cx + barW / 2},${y + r} V${padT + plotH} Z`
      : '';
    if (path) svg.append(s('path', { d: path, class: 'bar' }));
    // invisible hit target bigger than the bar
    const hit = s('rect', { x: cx - slot / 2, y: padT, width: slot, height: plotH, fill: 'transparent' });
    hit.addEventListener('mouseenter', () => {
      tip.textContent = d.tip ?? `${d.label}: ${format(d.value)}`;
      tip.classList.remove('hidden');
      const box = svg.getBoundingClientRect();
      tip.style.left = `${(cx / W) * box.width}px`;
      tip.style.top = `${(y / H) * box.height}px`;
    });
    hit.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    svg.append(hit);
    if (i % labelEvery === 0) {
      const t = s('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' });
      t.textContent = d.label;
      svg.append(t);
    }
  });
  wrap.append(svg, tip);
  return wrap;
}
