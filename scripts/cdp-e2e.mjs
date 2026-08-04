#!/usr/bin/env node
// CDP E2E 驱动：连接 localhost:3000 应用页，执行表达式并打印返回值。
// 用法：node scripts/cdp-e2e.mjs '<js expression>'
import { get } from 'node:http';
const WS = globalThis.WebSocket;

function getJson(url) {
  return new Promise((res, rej) =>
    get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej),
  );
}

async function main(expr) {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:3000'));
  if (!page) throw new Error('APP PAGE NOT FOUND: ' + pages.map((p) => p.url).join(' | '));
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m.result.result.value);
      pend.delete(m.id);
    }
  };
  const ev = (expression) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(
        JSON.stringify({
          id: i,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
  const out = await ev(expr);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  ws.close();
}

main(process.argv[2]).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
