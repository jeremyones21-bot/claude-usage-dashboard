const $ = (sel) => document.querySelector(sel);
const tooltip = $('#tooltip');

const state = { hours: 168, summary: null, rows: [] };

const fmtTime = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const fmtDayTime = new Intl.DateTimeFormat([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat([], { weekday: 'short' });
const fmtDate = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });

const MAX_GAP = 3 * 3_600_000;

function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function pct(v) {
  return v == null ? '—' : `${v >= 99.95 ? 100 : v.toFixed(v < 10 ? 1 : 0)}%`;
}

async function load() {
  const [summary, history] = await Promise.all([
    fetch('/api/summary').then((r) => r.json()),
    fetch(`/api/history?hours=${state.hours}`).then((r) => r.json()),
  ]);
  state.summary = summary;
  state.rows = history.rows;
  render();
}

function render() {
  renderHeader();
  renderCards();
  renderCharts();
  renderTable();
  renderFooter();
}

function renderHeader() {
  const s = state.summary;
  $('#last-updated').textContent = s.latest
    ? `updated ${fmtTime.format(s.latest.ts)}`
    : 'no data yet';
  const p = s.poller;
  $('#poll-status').textContent = p.lastError
    ? `⚠ last poll failed: ${p.lastError.message}`
    : p.intervalMinutes
      ? `polling every ${p.intervalMinutes} min`
      : 'ingest-only mode';
}

function severity(util) {
  if (util >= 90) return 'crit';
  if (util >= 75) return 'warn';
  return '';
}

function meterCard({ label, win, proj }) {
  if (!win || win.utilization == null) {
    return card(label, '—', '<div class="sub">no data</div>');
  }
  const sev = severity(win.utilization);
  const resets = win.resetsAt
    ? `resets in <strong>${fmtDuration(win.resetsAt - Date.now())}</strong> (${fmtDayTime.format(win.resetsAt)})`
    : '';
  let pace = '';
  if (proj) {
    if (proj.willHitLimit && proj.hitAt) {
      pace = `<div class="sub crit">⚠ At this pace: limit hit ${fmtDayTime.format(proj.hitAt)}${
        proj.resetsAt ? `, ${fmtDuration(proj.resetsAt - proj.hitAt)} before reset` : ''}</div>`;
    } else if (proj.ratePerHour > 0.01) {
      pace = '<div class="sub ok">✓ On pace to stay under the limit until reset</div>';
    }
  }
  return card(
    label,
    pct(win.utilization),
    `<div class="meter ${sev}"><div style="width:${Math.min(win.utilization, 100)}%"></div></div>
     <div class="sub">${resets}</div>${pace}`,
  );
}

function card(label, value, extra = '') {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div>${extra}</div>`;
}

function sparkline(daily) {
  if (!daily.length) return '';
  const w = 120, h = 28, max = Math.max(...daily.map((d) => d.value), 1);
  const step = w / (daily.length - 1 || 1);
  const pts = daily.map((d, i) =>
    `${(i * step).toFixed(1)},${(h - 2 - (d.value / max) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg width="${w}" height="${h}" aria-hidden="true" style="margin-top:8px">
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--baseline)" stroke-width="1.5"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--series-1)"/>
  </svg>`;
}

function renderCards() {
  const s = state.summary;
  const cards = [];

  cards.push(meterCard({
    label: 'Session · 5-hour window',
    win: s.latest?.fiveHour,
    proj: s.fiveHourProjection,
  }));
  cards.push(meterCard({
    label: 'Weekly · 7-day window',
    win: s.latest?.sevenDay,
    proj: s.sevenDayProjection,
  }));

  const { last24h, prior24h } = s.burn;
  const delta = last24h - prior24h;
  const deltaTxt = prior24h > 0.05 || last24h > 0.05
    ? `<div class="sub">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts vs prior 24h</div>`
    : '';
  cards.push(card(
    'Burn rate · last 24h',
    `${last24h.toFixed(1)}<span style="font-size:16px;color:var(--text-muted)"> pts/day</span>`,
    `<div class="sub">of weekly quota</div>${deltaTxt}${sparkline(s.daily)}`,
  ));

  const today = s.daily[s.daily.length - 1];
  const yesterday = s.daily[s.daily.length - 2];
  cards.push(card(
    'Used today',
    today ? `${today.value.toFixed(1)}<span style="font-size:16px;color:var(--text-muted)"> pts</span>` : '—',
    yesterday ? `<div class="sub">yesterday: <strong>${yesterday.value.toFixed(1)} pts</strong></div>` : '',
  ));

  $('#cards').innerHTML = cards.join('');
}

// ---------------------------------------------------------------- charts ---

const SVG = 'http://www.w3.org/2000/svg';
function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function chartCard(title, desc, svg) {
  const div = document.createElement('div');
  div.className = 'chart-card';
  div.innerHTML = `<h2>${title}</h2><div class="desc">${desc}</div>`;
  div.append(svg ?? emptyNote());
  return div;
}

function emptyNote() {
  const d = document.createElement('div');
  d.className = 'empty';
  d.textContent = 'Collecting data — this chart fills in after a few snapshots.';
  return d;
}

function timeTicks(t0, t1, n = 5) {
  const span = t1 - t0;
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(t0 + (span * i) / n);
  return ticks;
}

function lineChart(rows, key) {
  const pts = rows.filter((r) => r[key] != null);
  if (pts.length < 2) return null;

  const W = 1000, H = 240, M = { t: 14, r: 56, b: 26, l: 36 };
  const t1 = Date.now(), t0 = t1 - state.hours * 3_600_000;
  const x = (ts) => M.l + ((ts - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / 100) * (H - M.t - M.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });

  for (const v of [0, 25, 50, 75, 100]) {
    svg.append(el('line', {
      x1: M.l, x2: W - M.r, y1: y(v), y2: y(v),
      stroke: v === 0 ? 'var(--baseline)' : 'var(--grid)', 'stroke-width': 1,
    }));
    svg.append(el('text', {
      x: M.l - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis-text',
    }, [String(v)]));
  }
  const span = t1 - t0;
  for (const t of timeTicks(t0, t1)) {
    svg.append(el('text', {
      x: x(t), y: H - 8, 'text-anchor': 'middle', class: 'axis-text',
    }, [span > 2 * 86_400_000 ? fmtDate.format(t) : fmtTime.format(t)]));
  }

  // Split into segments at long gaps so sleep periods don't draw a false line.
  const segments = [];
  let seg = [];
  for (const p of pts) {
    if (seg.length && p.ts - seg[seg.length - 1].ts > MAX_GAP) {
      segments.push(seg);
      seg = [];
    }
    seg.push(p);
  }
  segments.push(seg);

  for (const s of segments) {
    if (s.length < 2) continue;
    const d = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    svg.append(el('path', {
      d: `${d}L${x(s[s.length - 1].ts).toFixed(1)},${y(0)}L${x(s[0].ts).toFixed(1)},${y(0)}Z`,
      fill: 'var(--series-1)', opacity: 0.1,
    }));
    svg.append(el('path', {
      d, fill: 'none', stroke: 'var(--series-1)',
      'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }

  const last = pts[pts.length - 1];
  svg.append(el('circle', {
    cx: x(last.ts), cy: y(last[key]), r: 5,
    fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2,
  }));
  svg.append(el('text', {
    x: x(last.ts) + 10, y: y(last[key]) + 4, class: 'direct-label',
  }, [pct(last[key])]));

  attachLineHover(svg, pts, key, x, y, { W, H, M });
  return svg;
}

function attachLineHover(svg, pts, key, x, y, { W, H, M }) {
  const cross = el('line', {
    y1: M.t, y2: H - M.b, stroke: 'var(--baseline)', 'stroke-width': 1, opacity: 0,
  });
  const dot = el('circle', {
    r: 5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2, opacity: 0,
  });
  svg.append(cross, dot);

  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = null, bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(x(p.ts) - px);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    cross.setAttribute('x1', x(best.ts));
    cross.setAttribute('x2', x(best.ts));
    cross.setAttribute('opacity', 1);
    dot.setAttribute('cx', x(best.ts));
    dot.setAttribute('cy', y(best[key]));
    dot.setAttribute('opacity', 1);
    showTooltip(e, `${fmtDayTime.format(best.ts)}<br><span class="t-val">${pct(best[key])}</span> of window`);
  });
  svg.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    dot.setAttribute('opacity', 0);
    hideTooltip();
  });
}

function barChart(daily) {
  if (!daily.some((d) => d.value > 0)) return null;

  const W = 1000, H = 220, M = { t: 18, r: 12, b: 26, l: 36 };
  const max = Math.max(...daily.map((d) => d.value));
  const yMax = Math.max(Math.ceil(max / 5) * 5, 5);
  const y = (v) => M.t + (1 - v / yMax) * (H - M.t - M.b);
  const band = (W - M.l - M.r) / daily.length;
  const barW = Math.min(24, band * 0.55);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });

  const step = yMax / 5;
  for (let v = 0; v <= yMax; v += step) {
    svg.append(el('line', {
      x1: M.l, x2: W - M.r, y1: y(v), y2: y(v),
      stroke: v === 0 ? 'var(--baseline)' : 'var(--grid)', 'stroke-width': 1,
    }));
    svg.append(el('text', {
      x: M.l - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis-text',
    }, [String(v)]));
  }

  const maxIdx = daily.reduce((mi, d, i) => (d.value > daily[mi].value ? i : mi), 0);

  daily.forEach((d, i) => {
    const cx = M.l + band * i + band / 2;
    const bx = cx - barW / 2;
    const top = y(d.value), bottom = y(0);
    const h = bottom - top;
    if (h > 0.5) {
      const r = Math.min(4, h);
      svg.append(el('path', {
        d: `M${bx},${bottom}L${bx},${top + r}Q${bx},${top} ${bx + r},${top}L${bx + barW - r},${top}Q${bx + barW},${top} ${bx + barW},${top + r}L${bx + barW},${bottom}Z`,
        fill: 'var(--series-1)',
      }));
    }
    // Label selectively: the max bar and today.
    if ((i === maxIdx || i === daily.length - 1) && d.value > 0) {
      svg.append(el('text', {
        x: cx, y: top - 6, 'text-anchor': 'middle', class: 'direct-label',
      }, [d.value.toFixed(1)]));
    }
    const date = new Date(d.day + 'T12:00:00');
    svg.append(el('text', {
      x: cx, y: H - 8, 'text-anchor': 'middle', class: 'axis-text',
    }, [fmtDay.format(date)]));

    const hit = el('rect', {
      x: M.l + band * i, y: M.t, width: band, height: H - M.t - M.b, fill: 'transparent',
    });
    hit.addEventListener('pointermove', (e) =>
      showTooltip(e, `${fmtDate.format(date)}<br><span class="t-val">${d.value.toFixed(1)} pts</span> of weekly quota`));
    hit.addEventListener('pointerleave', hideTooltip);
    svg.append(hit);
  });

  return svg;
}

function renderCharts() {
  const container = $('#charts');
  container.innerHTML = '';
  container.append(
    chartCard(
      'Weekly window utilization',
      'Percent of the 7-day quota in use over time; drops are the window rolling off.',
      lineChart(state.rows, 'seven_day_util'),
    ),
    chartCard(
      'Session window utilization',
      'Percent of the 5-hour quota in use over time.',
      lineChart(state.rows, 'five_hour_util'),
    ),
    chartCard(
      'Daily consumption',
      'Quota consumed per day, in percentage points of the weekly window.',
      barChart(state.summary.daily),
    ),
  );
}

function renderTable() {
  const daily = state.summary.daily;
  $('#table-view').innerHTML = `
    <div class="chart-card">
      <h2>Daily consumption</h2>
      <div class="desc">Percentage points of the weekly quota consumed per calendar day.</div>
      <table class="data">
        <thead><tr><th>Day</th><th>Weekly quota used (pts)</th></tr></thead>
        <tbody>
          ${[...daily].reverse().map((d) => `
            <tr><td>${fmtDate.format(new Date(d.day + 'T12:00:00'))}</td>
                <td>${d.value.toFixed(1)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderFooter() {
  const s = state.summary;
  $('#footer').innerHTML = `
    <span>${s.snapshotCount.toLocaleString()} snapshots</span>
    <span>db: ${s.dbPath}</span>
    ${s.poller.lastSuccess ? `<span>last poll ${fmtTime.format(s.poller.lastSuccess)}</span>` : ''}`;
}

// ------------------------------------------------------------- tooltip ----

function showTooltip(e, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const pad = 14;
  let left = e.clientX + pad;
  let top = e.clientY + pad;
  const r = tooltip.getBoundingClientRect();
  if (left + r.width > innerWidth - 8) left = e.clientX - r.width - pad;
  if (top + r.height > innerHeight - 8) top = e.clientY - r.height - pad;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
function hideTooltip() {
  tooltip.style.display = 'none';
}

// ------------------------------------------------------------- controls ---

for (const btn of document.querySelectorAll('.controls button[data-hours]')) {
  btn.addEventListener('click', () => {
    state.hours = Number(btn.dataset.hours);
    for (const b of document.querySelectorAll('.controls button[data-hours]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    load();
  });
}

$('#table-toggle').addEventListener('click', () => {
  const showing = $('#table-view').hidden;
  $('#table-view').hidden = !showing;
  $('#charts').hidden = showing;
  $('#table-toggle').setAttribute('aria-pressed', String(showing));
});

load();
setInterval(load, 60_000);
