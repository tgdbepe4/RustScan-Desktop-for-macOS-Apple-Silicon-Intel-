/* Capture the current native WebView2 page over CDP (port 9223).
   usage: node scripts/shot-native.cjs <out.png> [waitMs] */
const http = require('http');
const fs = require('fs');

const out = process.argv[2];
const wait = Number(process.argv[3] || 900);
if (!out) {
  console.error('usage: node scripts/shot-native.cjs <out.png> [waitMs]');
  process.exit(1);
}

http.get('http://127.0.0.1:9223/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', async () => {
    const page = JSON.parse(d).find((p) => p.type === 'page');
    if (!page) throw new Error('no native page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const callId = ++id;
        pending.set(callId, resolve);
        ws.send(JSON.stringify({ id: callId, method, params }));
      });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result || m.error);
        pending.delete(m.id);
      }
    };
    await new Promise((r) => (ws.onopen = r));
    await new Promise((r) => setTimeout(r, wait));
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`written ${out}`);
    ws.close();
    process.exit(0);
  });
});
