import { invoke, listen, isTauri, winAction } from './bridge.js';
import './city.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const S = {
  running: false,
  phase: 'STANDBY',
  hosts: 0,
  ports: 0,
  total: 0,
  scanned: 0,
  open: 0,
  results: [],
  seen: new Set(),
  logs: [],
  startedAt: 0,
  elapsedMs: 0,
  scanId: null,
  filter: '',
  tab: 'results',
  sortKey: 'port',
  sortDir: 1,
  renderPending: false,
  summaryPending: false
};

const els = {
  form: $('scan-form'),
  targets: $('targets'),
  ports: $('ports'),
  customWrap: $('custom-wrap'),
  batch: $('batch'),
  timeout: $('timeout'),
  tries: $('tries'),
  exclude: $('exclude'),
  order: $('order'),
  interval: $('interval'),
  maxhosts: $('maxhosts'),
  udp: $('udp'),
  probe: $('probe'),
  scanBtn: $('btn-scan'),
  abortBtn: $('btn-abort'),
  phase: $('phase'),
  phaseSub: $('phase-sub'),
  phaseDot: $('phase-dot'),
  footDot: $('foot-dot'),
  footState: $('foot-state'),
  targetMeta: $('target-meta'),
  portMeta: $('port-meta'),
  mHosts: $('m-hosts'),
  mPorts: $('m-ports'),
  mOpen: $('m-open'),
  mRate: $('m-rate'),
  mTime: $('m-time'),
  bar: $('bar'),
  progress: $('progress'),
  tabCount: $('tab-count'),
  body: $('result-body'),
  tableScroll: $('table-scroll'),
  empty: $('empty-state'),
  console: $('console'),
  filter: $('filter'),
  toasts: $('toasts'),
  sOpen: $('s-open'),
  sHosts: $('s-hosts'),
  sTime: $('s-time'),
  sRate: $('s-rate'),
  sCov: $('s-cov'),
  sScanned: $('s-scanned'),
  svcBars: $('svc-bars'),
  hostList: $('host-list')
};

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

const pad = (n, w = 2) => String(n).padStart(w, '0');
const int = (n) => Number(n || 0).toLocaleString('en-US');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function nowStamp() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ------------------------------------------------------------------ */
/* logging                                                             */
/* ------------------------------------------------------------------ */

const TAG = { info: '[~]', hit: '[>]', warn: '[!]', err: '[x]' };

function log(message, level = 'info') {
  if (S.logs.length > 5000) S.logs.shift();
  const entry = { ts: nowStamp(), message, level };
  S.logs.push(entry);
  if (!els.console) return;
  const nearBottom = els.console.scrollHeight - els.console.scrollTop - els.console.clientHeight < 90;
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = entry.ts;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = TAG[level] || '[~]';
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = message;
  line.append(ts, tag, msg);
  els.console.appendChild(line);
  while (els.console.children.length > 1600) els.console.removeChild(els.console.firstChild);
  if (nearBottom) els.console.scrollTop = els.console.scrollHeight;
}

function clearConsole() {
  S.logs = [];
  els.console.innerHTML = '';
}

/* ------------------------------------------------------------------ */
/* toasts                                                              */
/* ------------------------------------------------------------------ */

function toast(message, kind = 'ok', sub = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'ok' ? '' : kind}`;
  el.textContent = message;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    el.appendChild(s);
  }
  els.toasts.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, 3600);
}

/* ------------------------------------------------------------------ */
/* UI state                                                            */
/* ------------------------------------------------------------------ */

function setPhase(phase, sub, cls = '') {
  S.phase = phase;
  els.phase.textContent = phase;
  els.phaseSub.textContent = sub || '';
  els.phase.className = `phase ${cls}`;
  els.phaseDot.style.background = cls === 'err' ? 'var(--red)' : cls === 'done' ? 'var(--cyan)' : cls === 'live' ? 'var(--acid)' : 'rgba(233,233,228,.35)';
  els.phaseDot.style.boxShadow = cls === 'err' ? '0 0 8px var(--red)' : cls === 'done' ? '0 0 8px var(--cyan)' : cls === 'live' ? '0 0 8px var(--acid)' : 'none';
}

function setRunning(running) {
  S.running = running;
  els.scanBtn.disabled = running;
  els.scanBtn.classList.toggle('scanning', running);
  els.scanBtn.querySelector('.scan-btn-label').textContent = running ? 'SWEEPING ...' : 'INITIATE SCAN';
  els.abortBtn.disabled = !running;
  els.footDot.style.background = running ? 'var(--acid)' : 'var(--ink-30)';
  els.footState.textContent = running ? 'SWEEP IN PROGRESS' : 'SYSTEM READY';
  $$('input, textarea, select', els.form).forEach((el) => {
    if (el === els.ports) {
      el.disabled = running || !els.customWrap.classList.contains('open');
    } else if (el.type !== 'submit' && el.type !== 'button') {
      el.disabled = running;
    }
  });
  els.scanBtn.disabled = running;
}

function updateProgressBar(pct, indeterminate = false) {
  const p = clamp(pct, 0, 100);
  els.bar.classList.toggle('indeterminate', indeterminate);
  if (!indeterminate) els.bar.style.width = `${p}%`;
  els.progress.setAttribute('aria-valuenow', String(Math.round(p)));
}

function elapsedMs() {
  if (!S.startedAt) return S.elapsedMs;
  if (S.running) return performance.now() - S.startedAt;
  return S.elapsedMs || (performance.now() - S.startedAt);
}

function updateMetrics() {
  els.mHosts.textContent = int(S.hosts);
  els.mPorts.textContent = int(S.ports);
  els.mOpen.textContent = int(S.open);
  els.mTime.textContent = fmtTime(elapsedMs());
  const secs = Math.max(0.001, elapsedMs() / 1000);
  const rate = S.scanned > 0 ? Math.round(S.scanned / secs) : 0;
  els.mRate.innerHTML = `${int(rate)}<em>pps</em>`;
  els.sOpen.textContent = int(S.open);
  els.sHosts.textContent = int(S.hosts);
  els.sTime.textContent = fmtTime(elapsedMs());
  els.sRate.textContent = int(rate);
  const cov = S.total ? (S.scanned / S.total) * 100 : 0;
  els.sCov.innerHTML = `${cov.toFixed(cov >= 10 ? 0 : 1)}<em>%</em>`;
  els.sScanned.textContent = int(S.scanned);
}

function resetScanState() {
  S.hosts = 0;
  S.ports = 0;
  S.total = 0;
  S.scanned = 0;
  S.open = 0;
  S.results = [];
  S.seen.clear();
  S.startedAt = 0;
  S.elapsedMs = 0;
  S.scanId = null;
  els.body.innerHTML = '';
  els.empty.hidden = false;
  els.tabCount.textContent = '0';
  updateProgressBar(0);
  updateMetrics();
  renderSummary();
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */

function resultKey(r) {
  return `${r.host}|${r.port}|${r.proto || 'tcp'}`;
}

function addResult(r) {
  const key = resultKey(r);
  if (S.seen.has(key)) return;
  S.seen.add(key);
  S.results.push(r);
  S.open = S.results.length;
  els.tabCount.textContent = int(S.open);
  els.empty.hidden = true;
  log(`${r.host}:${r.port}/${r.proto || 'tcp'} OPEN  ${r.service || 'unknown'}${r.banner ? '  // ' + r.banner : ''}`, 'hit');
  scheduleRender();
  scheduleSummary();
  updateMetrics();
}

function scheduleRender() {
  if (S.renderPending) return;
  S.renderPending = true;
  requestAnimationFrame(() => {
    S.renderPending = false;
    renderTable();
  });
}

function scheduleSummary() {
  if (S.summaryPending) return;
  S.summaryPending = true;
  setTimeout(() => {
    S.summaryPending = false;
    renderSummary();
  }, 180);
}

function currentRows() {
  const q = S.filter.trim().toLowerCase();
  let rows = S.results;
  if (q) {
    rows = rows.filter((r) =>
      String(r.port).includes(q) ||
      (r.host || '').toLowerCase().includes(q) ||
      (r.service || '').toLowerCase().includes(q) ||
      (r.banner || '').toLowerCase().includes(q)
    );
  }
  const key = S.sortKey;
  const dir = S.sortDir;
  return rows.slice().sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), 'en', { numeric: true }) * dir;
  });
}

const MAX_RENDER = 2000;

function renderTable() {
  const rows = currentRows();
  const frag = document.createDocumentFragment();
  const limit = Math.min(rows.length, MAX_RENDER);
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    const tr = document.createElement('tr');
    tr.dataset.key = resultKey(r);
    const tdPort = document.createElement('td');
    tdPort.className = 'port-cell';
    tdPort.textContent = String(r.port);
    const tdProto = document.createElement('td');
    tdProto.textContent = (r.proto || 'tcp').toUpperCase();
    const tdSvc = document.createElement('td');
    tdSvc.textContent = (r.service || 'UNKNOWN').toUpperCase();
    const tdHost = document.createElement('td');
    tdHost.textContent = r.host;
    const tdLat = document.createElement('td');
    tdLat.textContent = r.latencyMs != null ? `${r.latencyMs}ms` : '—';
    const tdBanner = document.createElement('td');
    tdBanner.textContent = r.banner || '—';
    tdBanner.title = r.banner || '';
    tr.append(tdPort, tdProto, tdSvc, tdHost, tdLat, tdBanner);
    frag.appendChild(tr);
  }
  els.body.replaceChildren(frag);
  if (rows.length > MAX_RENDER) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = `// DISPLAY CAPPED AT ${MAX_RENDER} ROWS — ${rows.length - MAX_RENDER} MORE IN EXPORT`;
    td.style.cssText = 'color:var(--ink-30);letter-spacing:.12em;font-size:9px;text-align:center;height:38px';
    tr.appendChild(td);
    els.body.appendChild(tr);
  }
  if (S.results.length === 0) els.empty.hidden = false;
}

function renderSummary() {
  const svc = new Map();
  const hosts = new Map();
  for (const r of S.results) {
    const name = (r.service || 'unknown').toLowerCase();
    svc.set(name, (svc.get(name) || 0) + 1);
    hosts.set(r.host, (hosts.get(r.host) || 0) + 1);
  }
  if (!S.results.length) {
    els.svcBars.innerHTML = '<p class="tele-empty">NO DATA // RUN A SWEEP</p>';
    els.hostList.innerHTML = '<p class="tele-empty">NO DATA // RUN A SWEEP</p>';
    return;
  }
  const top = Array.from(svc.entries()).sort((a, b) => b[1] - a[1]).slice(0, 9);
  const max = top.length ? top[0][1] : 1;
  els.svcBars.innerHTML = '';
  for (const [name, count] of top) {
    const row = document.createElement('div');
    row.className = 'svc-row';
    const n = document.createElement('span');
    n.className = 'svc-name';
    n.textContent = name;
    n.title = name;
    const track = document.createElement('span');
    track.className = 'svc-track';
    const bar = document.createElement('i');
    bar.style.width = `${Math.max(3, (count / max) * 100)}%`;
    track.appendChild(bar);
    const c = document.createElement('span');
    c.className = 'svc-count';
    c.textContent = String(count);
    row.append(n, track, c);
    els.svcBars.appendChild(row);
  }
  const hostEntries = Array.from(hosts.entries()).sort((a, b) => b[1] - a[1]);
  els.hostList.innerHTML = '';
  for (const [host, count] of hostEntries.slice(0, 48)) {
    const chip = document.createElement('span');
    chip.className = 'host-chip';
    chip.textContent = host;
    const b = document.createElement('b');
    b.textContent = String(count);
    chip.appendChild(b);
    els.hostList.appendChild(chip);
  }
  if (hostEntries.length > 48) {
    const more = document.createElement('span');
    more.className = 'host-chip';
    more.textContent = `+${hostEntries.length - 48} MORE`;
    els.hostList.appendChild(more);
  }
}

/* ------------------------------------------------------------------ */
/* params / preview                                                    */
/* ------------------------------------------------------------------ */

function selectedPreset() {
  const el = document.querySelector('input[name="preset"]:checked');
  return el ? el.value : 'top200';
}

function parsePortCount(spec) {
  let n = 0;
  for (const part of String(spec || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d{1,5})\s*-\s*(\d{1,5})$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a >= 1 && b <= 65535 && b >= a) n += b - a + 1;
    } else if (/^\d{1,5}$/.test(t)) {
      const p = Number(t);
      if (p >= 1 && p <= 65535) n += 1;
    }
  }
  return Math.min(65535, n);
}

function updatePortMeta() {
  const preset = selectedPreset();
  let count = 100;
  if (preset === 'quick') count = 1000;
  else if (preset === 'full') count = 65535;
  else if (preset === 'custom') count = parsePortCount(els.ports.value);
  els.portMeta.textContent = `${int(count)} PORTS`;
  els.portMeta.className = 'field-meta' + (count ? '' : ' err');
  return count;
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  const text = els.targets.value.trim();
  if (!text) {
    els.targetMeta.textContent = 'IP / CIDR / HOSTNAME';
    els.targetMeta.className = 'field-meta';
    return;
  }
  els.targetMeta.textContent = 'RESOLVING ...';
  els.targetMeta.className = 'field-meta';
  previewTimer = setTimeout(async () => {
    try {
      const p = await invoke('preview_targets', {
        text,
        maxHosts: Number(els.maxhosts.value) || 1024
      });
      if (p && p.hosts > 0) {
        const first = (p.ips && p.ips[0]) || '';
        els.targetMeta.textContent = `${int(p.hosts)} HOSTS${first ? ' // ' + first : ''}`;
        els.targetMeta.className = 'field-meta hot';
        S.hosts = p.hosts;
        els.mHosts.textContent = int(p.hosts);
      } else {
        els.targetMeta.textContent = 'NO RESOLVABLE VECTOR';
        els.targetMeta.className = 'field-meta err';
      }
    } catch (e) {
      els.targetMeta.textContent = 'PARSE ERROR';
      els.targetMeta.className = 'field-meta err';
    }
  }, 550);
}

function collectParams() {
  const preset = selectedPreset();
  let portsMode = 'range';
  let portSpec = '';
  if (preset === 'top200') {
    portsMode = 'top200';
  } else if (preset === 'quick') {
    portSpec = '1-1000';
  } else if (preset === 'full') {
    portSpec = '1-65535';
  } else {
    portSpec = els.ports.value.trim();
  }
  return {
    targets: els.targets.value.trim(),
    portsMode,
    portSpec,
    batch: clamp(Number(els.batch.value) || 1000, 1, 20000),
    timeout: clamp(Number(els.timeout.value) || 1000, 10, 10000),
    tries: clamp(Number(els.tries.value) || 1, 1, 10),
    exclude: els.exclude.value.trim(),
    order: els.order.value,
    interval: clamp(Number(els.interval.value) || 0, 0, 60000),
    maxHosts: clamp(Number(els.maxhosts.value) || 1024, 1, 4096),
    udp: els.udp.checked,
    probe: els.probe.checked
  };
}

/* ------------------------------------------------------------------ */
/* scan lifecycle                                                      */
/* ------------------------------------------------------------------ */

let ticker = null;

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (S.running) updateMetrics();
  }, 500);
}

async function startScan(e) {
  if (e) e.preventDefault();
  if (S.running) return;
  const params = collectParams();
  if (!params.targets) {
    toast('NO TARGET VECTOR', 'err', 'Enter an IP, CIDR or hostname.');
    els.targets.focus();
    return;
  }
  if (params.portsMode === 'range' && !params.portSpec) {
    toast('PORT VECTOR EMPTY', 'err', 'Define a range such as 1-1024 or 80,443.');
    els.ports.focus();
    return;
  }

  resetScanState();
  clearConsole();
  setRunning(true);
  setPhase('RESOLVING', 'RESOLVING TARGET VECTOR', 'live');
  updateProgressBar(8, true);
  S.startedAt = performance.now();
  S.elapsedMs = 0;
  startTicker();
  log('RUSTSCAN NEON GRID v2.4.1 // engine armed', 'info');
  log(`target vector: ${params.targets.replace(/\s+/g, ' ').slice(0, 160)}`, 'info');
  log(`preset=${params.portsMode} spec=${params.portSpec || 'TOP200'} batch=${params.batch} timeout=${params.timeout}ms tries=${params.tries} udp=${params.udp}`, 'info');

  try {
    const info = await invoke('start_scan', { params });
    if (info) {
      S.scanId = info.scanId;
      S.hosts = info.hosts;
      S.ports = info.ports;
      S.total = info.total;
      updateMetrics();
      log(`scan ${info.scanId} locked: ${int(info.hosts)} hosts × ${int(info.ports)} ports = ${int(info.total)} sockets`, 'hit');
    }
    setPhase('SWEEPING', 'ASYNC CONNECT SWEEP', 'live');
    updateProgressBar(0);
  } catch (err) {
    failScan(err);
  }
}

function failScan(err) {
  const message = typeof err === 'string' ? err : (err && err.message) || 'ENGINE FAILURE';
  setRunning(false);
  setPhase('FAULT', 'ENGINE RETURNED AN ERROR', 'err');
  updateProgressBar(0);
  log(message, 'err');
  toast('SCAN ABORTED', 'err', message.slice(0, 160));
  clearInterval(ticker);
}

async function abortScan() {
  if (!S.running) return;
  setPhase('ABORTING', 'TERMINATING ACTIVE SOCKETS', 'err');
  log('abort requested by operator', 'warn');
  try {
    await invoke('cancel_scan');
  } catch (err) {
    log(String(err), 'err');
  }
}

function finishScan(p) {
  setRunning(false);
  clearInterval(ticker);
  S.elapsedMs = p.elapsedMs || elapsedMs();
  S.scanned = p.scanned ?? S.scanned;
  S.total = p.total ?? S.total;
  S.open = p.open ?? S.open;
  if (p.cancelled) {
    setPhase('ABORTED', 'SWEEP TERMINATED BY OPERATOR', 'err');
    log(`scan aborted after ${fmtTime(S.elapsedMs)} // ${int(S.open)} open ports retained`, 'warn');
    toast('SWEEP ABORTED', 'warn', `${int(S.open)} open ports kept in the buffer.`);
  } else {
    setPhase('COMPLETE', 'SWEEP FINISHED', 'done');
    updateProgressBar(100);
    log(`scan complete in ${fmtTime(S.elapsedMs)} // ${int(S.open)} open ports across ${int(S.hosts)} hosts`, 'hit');
    toast('SWEEP COMPLETE', 'ok', `${int(S.open)} open ports // ${fmtTime(S.elapsedMs)}`);
  }
  updateMetrics();
  renderSummary();
}

/* ------------------------------------------------------------------ */
/* backend events                                                      */
/* ------------------------------------------------------------------ */

async function bindEvents() {
  await listen('scan://started', ({ payload: p }) => {
    S.scanId = p.scanId;
    S.hosts = p.hosts;
    S.ports = p.ports;
    S.total = p.total;
    S.startedAt = performance.now();
    setPhase('SWEEPING', 'ASYNC CONNECT SWEEP', 'live');
    updateProgressBar(2);
    updateMetrics();
  });

  await listen('scan://log', ({ payload: p }) => {
    log(p.message, p.level || 'info');
  });

  await listen('scan://progress', ({ payload: p }) => {
    S.scanned = p.scanned ?? S.scanned;
    S.total = p.total ?? S.total;
    S.open = p.open ?? S.open;
    S.elapsedMs = p.elapsedMs ?? S.elapsedMs;
    const pct = S.total ? (S.scanned / S.total) * 100 : 0;
    updateProgressBar(pct);
    updateMetrics();
    setPhase(p.phase || 'SWEEPING', `${pct.toFixed(pct >= 10 ? 0 : 1)}% // ${int(S.scanned)} OF ${int(S.total)} SOCKETS`, 'live');
  });

  await listen('scan://result', ({ payload: p }) => {
    addResult(p);
  });

  await listen('scan://done', ({ payload: p }) => {
    finishScan(p || {});
  });

  await listen('scan://error', ({ payload: p }) => {
    failScan(p && p.message ? p.message : 'ENGINE FAILURE');
  });
}

/* ------------------------------------------------------------------ */
/* tabs / actions                                                      */
/* ------------------------------------------------------------------ */

function switchTab(name) {
  S.tab = name;
  $$('.tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
}

function copyText(text, label = 'COPIED TO CLIPBOARD') {
  const write = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    toast(label, 'ok', text.length > 80 ? text.slice(0, 76) + '…' : text);
  };
  write();
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportAs(kind) {
  if (!S.results.length) {
    toast('NOTHING TO EXPORT', 'warn', 'Run a sweep first.');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  let contents;
  let name;
  if (kind === 'csv') {
    const header = 'host,port,proto,service,latency_ms,banner';
    const lines = S.results.map((r) =>
      [r.host, r.port, r.proto || 'tcp', r.service || '', r.latencyMs ?? '', r.banner || ''].map(csvEscape).join(',')
    );
    contents = header + '\n' + lines.join('\n') + '\n';
    name = `rustscan-neon-${stamp}.csv`;
  } else {
    contents = JSON.stringify({
      engine: 'RustScan 2.4.1',
      exportedAt: new Date().toISOString(),
      scanId: S.scanId,
      hosts: S.hosts,
      ports: S.ports,
      scanned: S.scanned,
      elapsedMs: S.elapsedMs,
      results: S.results
    }, null, 2);
    name = `rustscan-neon-${stamp}.json`;
  }
  try {
    const res = await invoke('save_export', { defaultName: name, contents });
    if (res && res.path) {
      log(`export written: ${res.path}`, 'hit');
      toast('EXPORT WRITTEN', 'ok', res.path);
    }
  } catch (err) {
    toast('EXPORT FAILED', 'err', String(err));
  }
}

async function pickFile() {
  try {
    const res = await invoke('pick_target_file');
    if (!res) return;
    els.targets.value = res.content;
    schedulePreview();
    log(`target file loaded: ${res.name}`, 'info');
    toast('TARGET FILE LOADED', 'ok', res.name);
  } catch (err) {
    toast('FILE READ FAILED', 'err', String(err));
  }
}

async function pasteTargets() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error('clipboard empty');
    els.targets.value = text;
    schedulePreview();
    toast('CLIPBOARD INGESTED', 'ok', `${text.split(/[\s,;]+/).filter(Boolean).length} tokens`);
  } catch (e) {
    toast('CLIPBOARD BLOCKED', 'warn', 'Focus the target field and press Ctrl+V.');
    els.targets.focus();
  }
}

/* ------------------------------------------------------------------ */
/* demo seed (browser preview)                                         */
/* ------------------------------------------------------------------ */

const DEMO_ROWS = [
  ['10.0.0.12', 22, 'SSH', 3, 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13'],
  ['10.0.0.12', 80, 'HTTP', 5, 'HTTP/1.1 200 OK // nginx/1.24.0'],
  ['10.0.0.12', 443, 'HTTPS', 6, 'TLS 1.3 // CN=*.nightcity.local'],
  ['10.0.0.12', 3306, 'MYSQL', 4, '8.0.36-0ubuntu0.24.04.1'],
  ['10.0.0.12', 6379, 'REDIS', 2, '-NOAUTH Authentication required.'],
  ['10.0.0.23', 22, 'SSH', 8, 'SSH-2.0-OpenSSH_8.9p1 Debian-3'],
  ['10.0.0.23', 111, 'RPCBIND', 3, 'portmapper v2 // rpcbind 1.2.6'],
  ['10.0.0.23', 445, 'SMB', 9, 'SMB 3.1.1 // signing enabled'],
  ['10.0.0.23', 3389, 'RDP', 14, 'RDP 10.0 // NLA required'],
  ['10.0.0.23', 8080, 'HTTP-ALT', 7, 'HTTP/1.1 302 Found // Jetty 11.0.20'],
  ['10.0.0.44', 80, 'HTTP', 4, 'HTTP/1.1 200 OK // Apache/2.4.58'],
  ['10.0.0.44', 443, 'HTTPS', 5, 'TLS 1.2 // Apache Tomcat 10.1'],
  ['10.0.0.44', 5432, 'POSTGRESQL', 6, 'PostgreSQL 16.2 on x86_64-pc-linux-gnu'],
  ['10.0.0.44', 9200, 'ELASTICSEARCH', 11, 'HTTP/1.1 200 OK // cluster_name=night-city'],
  ['10.0.0.44', 27017, 'MONGODB', 8, 'MongoDB 7.0.5 // wire version 21'],
  ['10.0.0.87', 22, 'SSH', 5, 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13'],
  ['10.0.0.87', 9000, 'PHP-FPM', 4, 'PHP-FPM 8.3 // fastcgi'],
  ['10.0.0.87', 8443, 'HTTPS-ALT', 7, 'TLS 1.2 // Tomcat 10.1'],
  ['10.0.0.101', 53, 'DNS', 2, 'BIND 9.18.24 // recursion enabled'],
  ['10.0.0.101', 80, 'HTTP', 6, 'HTTP/1.1 301 Moved Permanently // Caddy'],
  ['10.0.0.101', 443, 'HTTPS', 5, 'TLS 1.3 // h2 // Caddy'],
  ['10.0.0.150', 21, 'FTP', 12, '220 (vsFTPd 3.0.5)'],
  ['10.0.0.150', 25, 'SMTP', 15, '220 mail.nightcity.local ESMTP Postfix'],
  ['10.0.0.150', 139, 'NETBIOS', 7, 'NetBIOS-SSN // session service'],
  ['10.0.0.150', 5900, 'VNC', 6, 'RFB 003.008'],
  ['10.0.0.150', 11211, 'MEMCACHED', 3, 'VERSION 1.6.21']
];

function seedDemo(mode) {
  els.targets.value = '10.0.0.0/24';
  schedulePreview();
  S.hosts = 254;
  S.ports = 65535;
  S.total = 254 * 65535;
  S.scanned = 254 * 65535;
  S.startedAt = performance.now();
  S.elapsedMs = 74200;
  S.scanId = 'NIGHT-7F3A';
  setRunning(false);
  setPhase('COMPLETE', 'SWEEP FINISHED', 'done');
  updateProgressBar(100);
  DEMO_ROWS.forEach(([host, port, service, lat, banner]) => {
    S.results.push({ id: S.results.length + 1, host, port, proto: 'tcp', service, latencyMs: lat, banner });
    S.seen.add(resultKey({ host, port, proto: 'tcp' }));
  });
  S.open = S.results.length;
  els.tabCount.textContent = int(S.open);
  els.empty.hidden = true;
  updateMetrics();
  renderTable();
  renderSummary();
  log('RUSTSCAN NEON GRID v2.4.1 // engine armed', 'info');
  log('target vector: 10.0.0.0/24 // preset=FULL', 'info');
  log('scan NIGHT-7F3A locked: 254 hosts × 65,535 ports = 16,645,890 sockets', 'hit');
  log('sweep complete in 01:14 // 26 open ports across 6 hosts', 'hit');
  DEMO_ROWS.slice(-5).forEach(([host, port, service, , banner]) => {
    log(`${host}:${port}/tcp OPEN  ${service}  // ${banner}`, 'hit');
  });
  if (mode === 'console') switchTab('console');
  else if (mode === 'summary') switchTab('summary');
  else switchTab('results');
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  els.form.addEventListener('submit', startScan);
  els.abortBtn.addEventListener('click', abortScan);
  $('btn-file').addEventListener('click', pickFile);
  $('btn-paste').addEventListener('click', pasteTargets);
  $('btn-local').addEventListener('click', () => {
    els.targets.value = '127.0.0.1';
    schedulePreview();
    els.targets.focus();
  });
  $('btn-clear').addEventListener('click', () => {
    els.targets.value = '';
    els.targetMeta.textContent = 'IP / CIDR / HOSTNAME';
    els.targetMeta.className = 'field-meta';
    els.targets.focus();
  });

  $$('input[name="preset"]').forEach((el) => {
    el.addEventListener('change', () => {
      const custom = selectedPreset() === 'custom';
      els.customWrap.classList.toggle('open', custom);
      els.customWrap.setAttribute('aria-hidden', String(!custom));
      els.ports.disabled = !custom || S.running;
      if (custom) setTimeout(() => els.ports.focus(), 120);
      updatePortMeta();
    });
  });
  els.ports.addEventListener('input', updatePortMeta);
  els.targets.addEventListener('input', () => {
    schedulePreview();
    updatePortMeta();
  });

  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  els.filter.addEventListener('input', () => {
    S.filter = els.filter.value;
    renderTable();
  });

  $('btn-csv').addEventListener('click', () => exportAs('csv'));
  $('btn-json').addEventListener('click', () => exportAs('json'));
  $('btn-copy-log').addEventListener('click', () => {
    copyText(S.logs.map((l) => `[${l.ts}] ${TAG[l.level] || ''} ${l.message}`).join('\n'), 'CONSOLE COPIED');
  });
  $('btn-clear-log').addEventListener('click', () => {
    clearConsole();
    log('console cleared // stream attached', 'info');
  });

  els.body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    const [host, port] = tr.dataset.key.split('|');
    copyText(`${host}:${port}`, 'TARGET COPIED');
  });

  const sortMap = { 'col-port': 'port', 'col-service': 'service', 'col-host': 'host', 'col-lat': 'latencyMs' };
  $$('.table-head span').forEach((h) => {
    const key = sortMap[h.className];
    if (!key) return;
    h.style.cursor = 'pointer';
    h.addEventListener('click', () => {
      S.sortDir = S.sortKey === key ? -S.sortDir : 1;
      S.sortKey = key;
      renderTable();
    });
  });

  $('win-min').addEventListener('click', () => winAction('min'));
  $('win-max').addEventListener('click', () => winAction('max'));
  $('win-close').addEventListener('click', () => winAction('close'));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!S.running) startScan();
    }
    if (e.key === 'Escape' && S.running) {
      e.preventDefault();
      abortScan();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      els.filter.focus();
      els.filter.select();
    }
  });

  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }, 1000);
}

async function boot() {
  wire();
  // Fit the fixed 1440×900 composition onto smaller logical desktops
  // (1366×768, 1080p at 125%, 1080p at 150%).
  if (isTauri) {
    try {
      if (window.screen.availWidth < 1500 || window.screen.availHeight < 940) {
        invoke('window_control', { action: 'max' }).catch(() => {});
      }
    } catch (e) { /* keep configured size */ }
  }
  updatePortMeta();
  setPhase('STANDBY', 'NO ACTIVE SWEEP');
  log('RUSTSCAN NEON GRID v2.4.1', 'info');
  log('async engine armed // 65535 port space // TCP + UDP', 'info');
  log(isTauri ? 'native bridge online // WebView2 runtime' : 'browser preview // simulated engine', 'info');
  log('awaiting target vector // [CTRL+ENTER] to initiate', 'info');
  await bindEvents();

  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  if (demo === '1' || demo === 'console' || demo === 'summary') {
    seedDemo(demo);
  } else if (demo === 'scan') {
    els.targets.value = '10.0.0.0/24';
    schedulePreview();
    setTimeout(() => startScan(), 700);
  }
}

boot();
