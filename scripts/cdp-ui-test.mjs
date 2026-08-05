#!/usr/bin/env node
// 模拟双击任务节点，验证 ConsoleTab 显示输出
import { get } from 'node:http';
const WS = globalThis.WebSocket;
function getJson(url) {
  return new Promise((res, rej) =>
    get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej),
  );
}
async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page' && p.title.includes('SMT'));
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result?.result?.value); pend.delete(m.id); }
  };
  const ev = (expression) =>
    new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
  const expr = (body) => `(async () => { try { return await (${body}); } catch (e) { return 'ERR: ' + e; } })()`;

  const step = async (name, body) => {
    const out = await ev(expr(body));
    console.log(`=== ${name} ===`);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  };

  await step('1. 找到 file-server 任务行并双击', `(() => {
    const rows = [...document.querySelectorAll('div')];
    const row = rows.find(r => r.childElementCount >= 2 && r.textContent.trim() === 'file-server');
    if (!row) return 'ROW NOT FOUND';
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'dblclick dispatched';
  })()`);

  console.log('\n等待 4 秒（tab 打开 + 自动启动 + 输出到达）…');
  await new Promise((r) => setTimeout(r, 4000));

  await step('2. 当前 tab 内容', `document.body.innerText.slice(0, 800)`);

  await step('3. 页面状态栏', `(() => {
    const m = document.body.innerText.match(/\\d+ 运行中/);
    return m ? m[0] : 'no match';
  })()`);

  ws.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
