#!/usr/bin/env node
// 调试：打印 CDP 原始返回
import { get } from 'node:http';
const WS = globalThis.WebSocket;
function getJson(url) {
  return new Promise((res, rej) =>
    get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej),
  );
}
async function main(expr) {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page' && p.title.includes('SMT'));
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const ev = (expression) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  const raw = await ev(expr);
  console.log(JSON.stringify(raw, null, 2));
  ws.close();
}
main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
