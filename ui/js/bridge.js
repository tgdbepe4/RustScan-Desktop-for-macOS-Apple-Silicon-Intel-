/* Bridge between the UI and the Tauri backend.
   When the page is opened in a normal browser (design preview / QA),
   a deterministic simulator stands in for the Rust engine. */

const T = window.__TAURI__;
export const isTauri = !!(T && T.core && typeof T.core.invoke === 'function');

const listeners = new Map();
const mock = { timer: null, cancel: false, seq: 0 };

function emit(event, payload) {
  const arr = listeners.get(event) || [];
  for (const cb of arr) {
    try { cb({ event, payload }); } catch (e) { console.error(e); }
  }
}

export async function invoke(cmd, args = {}) {
  if (isTauri) return T.core.invoke(cmd, args);
  return mockInvoke(cmd, args);
}

export async function listen(event, cb) {
  if (isTauri) return T.event.listen(event, cb);
  const arr = listeners.get(event) || [];
  arr.push(cb);
  listeners.set(event, arr);
  return () => {
    const cur = listeners.get(event) || [];
    listeners.set(event, cur.filter((fn) => fn !== cb));
  };
}

export function winAction(action) {
  if (!isTauri) return;
  invoke('window_control', { action }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Browser simulator                                                   */
/* ------------------------------------------------------------------ */

const SAMPLE_HOSTS = ['10.0.0.12', '10.0.0.23', '10.0.0.44', '10.0.0.87', '10.0.0.101', '10.0.0.150'];
const SAMPLE = [
  [22, 'SSH', 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13'],
  [80, 'HTTP', 'nginx/1.24.0 (Ubuntu)'],
  [111, 'RPCBIND', 'portmapper v2'],
  [443, 'HTTPS', 'TLS 1.3 // certificate CN=*.nightcity.local'],
  [445, 'SMB', 'SMB 3.1.1 // signing enabled'],
  [3306, 'MYSQL', '8.0.36-0ubuntu0.24.04.1'],
  [3389, 'RDP', 'RDP 10.0 // NLA required'],
  [5432, 'POSTGRESQL', 'PostgreSQL 16.2 on x86_64-pc-linux-gnu'],
  [6379, 'REDIS', '-NOAUTH Authentication required.'],
  [8080, 'HTTP-ALT', 'Jetty 11.0.20 // 302 Found'],
  [8443, 'HTTPS-ALT', 'TLS 1.2 // Tomcat 10.1'],
  [9000, 'PHP-FPM', 'PHP-FPM 8.3 // fastcgi'],
  [9200, 'ELASTICSEARCH', 'HTTP/1.1 200 OK // cluster_name=night-city'],
  [27017, 'MONGODB', 'MongoDB 7.0.5 // wire version 21']
];

function previewTargets(text) {
  const tokens = String(text || '').split(/[\s,;]+/).filter(Boolean);
  let hosts = 0;
  const ips = [];
  for (const t of tokens) {
    if (/\/\d{1,3}$/.test(t)) {
      const prefix = Number(t.split('/')[1]);
      const bits = 32 - prefix;
      const n = bits === 0 ? 1 : bits === 1 ? 2 : Math.max(0, 2 ** bits - 2);
      hosts += Math.min(4096, Math.max(1, n));
      ips.push(t);
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) {
      hosts += 1;
      ips.push(t);
    } else {
      hosts += 1;
      ips.push(t);
    }
  }
  return { hosts, ips: ips.slice(0, 12), resolved: ips.slice(0, 12) };
}

function mockPorts(params) {
  if (params.portsMode === 'top200') return 100;
  if (params.portsMode === 'full') return 65535;
  const spec = params.portSpec || '';
  let n = 0;
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) n += Math.max(0, Number(m[2]) - Number(m[1]) + 1);
    else if (/^\d+$/.test(part.trim())) n += 1;
  }
  return Math.max(1, Math.min(65535, n));
}

async function mockInvoke(cmd, args) {
  if (cmd === 'env_info') {
    return { version: '2.4.1', engine: 'RustScan 2.4.1', os: 'Windows 10 Pro 22H2', arch: 'x86_64', mode: 'BROWSER PREVIEW' };
  }
  if (cmd === 'preview_targets') return previewTargets(args.text);
  if (cmd === 'pick_target_file') {
    return {
      name: 'targets.txt',
      content: '10.0.0.12\n10.0.0.23\n10.0.0.44\n10.0.0.0/28\nscanme.nightcity.local'
    };
  }
  if (cmd === 'save_export') {
    try {
      const blob = new Blob([args.contents], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = args.defaultName || 'rustscan-export.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) { /* preview mode */ }
    return { path: args.defaultName || 'download' };
  }
  if (cmd === 'cancel_scan') {
    mock.cancel = true;
    clearInterval(mock.timer);
    mock.timer = null;
    return true;
  }
  if (cmd === 'start_scan') {
    startMockScan(args.params || {});
    const hosts = Math.max(1, previewTargets(args.params?.targets).hosts);
    const ports = mockPorts(args.params || {});
    return {
      scanId: 'MOCK-' + Date.now().toString(36).toUpperCase(),
      hosts, ports, total: hosts * ports,
      batch: Number(args.params?.batch || 3000),
      timeout: Number(args.params?.timeout || 180),
      udp: !!args.params?.udp,
      probe: args.params?.probe !== false
    };
  }
  return null;
}

function startMockScan(params) {
  clearInterval(mock.timer);
  mock.cancel = false;
  const hosts = Math.max(1, Math.min(24, previewTargets(params.targets).hosts));
  const ports = mockPorts(params);
  const total = hosts * ports;
  const started = performance.now();
  let scanned = 0;
  let open = 0;
  let hostPool = SAMPLE_HOSTS.slice(0, Math.min(hosts, SAMPLE_HOSTS.length));
  if (!hostPool.length) hostPool = ['127.0.0.1'];

  emit('scan://started', {
    scanId: 'MOCK-' + Date.now().toString(36).toUpperCase(),
    hosts, ports, total,
    batch: Number(params.batch || 3000),
    timeout: Number(params.timeout || 180),
    udp: !!params.udp,
    probe: params.probe !== false
  });

  const tick = setInterval(() => {
    if (mock.cancel) return;
    const step = Math.max(1, Math.floor(total / 46));
    scanned = Math.min(total, scanned + step);
    if (Math.random() > 0.42 && open < 26) {
      const [port, service, banner] = SAMPLE[(mock.seq++) % SAMPLE.length];
      const host = hostPool[(mock.seq + 1) % hostPool.length];
      open += 1;
      emit('scan://result', {
        id: mock.seq,
        host, port,
        proto: params.udp ? 'udp' : 'tcp',
        service,
        latencyMs: 2 + Math.floor(Math.random() * 38),
        banner
      });
    }
    const elapsed = performance.now() - started;
    emit('scan://progress', {
      scanned, total, open,
      elapsedMs: Math.round(elapsed),
      rate: scanned / Math.max(0.001, elapsed / 1000),
      phase: 'SWEEPING'
    });
    if (scanned >= total) {
      clearInterval(mock.timer);
      mock.timer = null;
      setTimeout(() => {
        emit('scan://done', {
          cancelled: false,
          elapsedMs: Math.round(performance.now() - started),
          hosts, ports, total, scanned, open
        });
      }, 420);
    }
  }, 150);
  mock.timer = tick;
}

export function stopPreviewTimer() {
  clearInterval(mock.timer);
  mock.timer = null;
}
