// CDP probe: connect to the running app's WebView2 and dump DOM state.
const http = require('http');
const WS = globalThis.WebSocket;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = ++evaluate.id;
    evaluate.pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}
evaluate.id = 0;
evaluate.pending = new Map();

(async () => {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && evaluate.pending.has(msg.id)) {
      const { resolve, reject } = evaluate.pending.get(msg.id);
      evaluate.pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result.result.value);
    }
  };

  const probe = `JSON.stringify({
    title: document.title,
    hasTopNav: !!document.querySelector('.h-7') && document.body.innerText.includes('SMT Task Manager'),
    bodyText: document.body.innerText.slice(0, 600),
    taskTreeVisible: document.body.innerText.includes('任务树'),
    hasFileServer: document.body.innerText.includes('file-server'),
    hasFolder: document.body.innerText.includes('Web 服务'),
    tabs: document.querySelectorAll('.flexlayout__tab_button').length,
  })`;
  const result = await evaluate(ws, probe);
  console.log(JSON.stringify(JSON.parse(result), null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('PROBE-FAIL', e.message); process.exit(1); });
