const http = require('http');
const expr = process.argv.slice(2).join(' ');
http.get('http://127.0.0.1:9222/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }));
    ws.onmessage = (m) => {
      const r = JSON.parse(m.data);
      if (r.id === 1) {
        console.log(JSON.stringify(r.result, null, 2));
        ws.close();
      }
    };
  });
});
