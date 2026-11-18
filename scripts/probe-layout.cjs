/* Reports layout metrics for a viewport on the headless Chrome CDP endpoint.
   usage: node scripts/probe-layout.cjs <width> <height> */
const http = require('http');

const w = Number(process.argv[2] || 900);
const h = Number(process.argv[3] || 700);

http.get('http://127.0.0.1:9222/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', async () => {
    const page = JSON.parse(d).find((p) => p.type === 'page');
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
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/ui/' });
    await new Promise((r) => setTimeout(r, 2200));
    const expr = `JSON.stringify({
      inner:[innerWidth,innerHeight],
      doc:[document.documentElement.clientWidth,document.documentElement.clientHeight],
      scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
      bodyW:document.body.getBoundingClientRect().width,
      shellW:document.querySelector('.shell').getBoundingClientRect().width,
      railW:document.querySelector('.rail').getBoundingClientRect().width,
      wsW:document.querySelector('.workspace').getBoundingClientRect().width,
      media900:matchMedia('(max-width: 900px)').matches,
      shellDisplay:getComputedStyle(document.querySelector('.shell')).display,
      railWidth:getComputedStyle(document.querySelector('.rail')).width,
      appW:document.querySelector('#app').getBoundingClientRect().width,
      appH:document.querySelector('#app').getBoundingClientRect().height,
      railRect:(()=>{const r=document.querySelector('.rail').getBoundingClientRect();return [r.top,r.height]})
      ,wsRect:(()=>{const r=document.querySelector('.workspace').getBoundingClientRect();return [r.top,r.height]})
      ,bodyH:document.body.scrollHeight
      ,htmlOverflow:getComputedStyle(document.documentElement).overflowY
      ,bodyOverflow:getComputedStyle(document.body).overflowY
    }).replace(/\\n/g,'')`;
    const out = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true
    });
    console.log(out.result.value);
    ws.close();
    process.exit(0);
  });
});
