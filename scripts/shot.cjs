/* CDP screenshot helper: viewport-accurate, unlike --window-size.
   usage: node scripts/shot.cjs <url> <out.png> [width] [height] [waitMs] */
const http = require('http');
const fs = require('fs');

const [url, out, w = '1440', h = '900', wait = '3600'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/shot.cjs <url> <out.png> [width] [height] [waitMs]');
  process.exit(1);
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222' + path, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

(async () => {
  const pages = await getJson('/json');
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result || msg.error);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve) => (ws.onopen = resolve));
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, Number(wait)));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`written ${out}`);
  ws.close();
  process.exit(0);
})();
